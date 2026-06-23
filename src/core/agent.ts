import * as restate from "@restatedev/restate-sdk";
import type { ObjectContext, ObjectOptions } from "@restatedev/restate-sdk";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { durableCalls } from "@restatedev/vercel-ai-middleware";
import { NoopDeliveryAdapter, NoopStreamAdapter } from "./delivery/index.ts";
import type { AgentTool } from "./tool/index.ts";
import type { DeliveryAdapter, DeliveryTarget, OutboxMessage, WireEvent } from "./delivery/index.ts";
import type { StreamAdapter } from "./delivery/index.ts";
import { errorClassifierMiddleware, LLM_RETRY_OPTIONS } from "./retry.ts";
import { createMemoryAdapter, MemoryAdapter } from "./memory.ts";

/**
 * Per-step metering report emitted by the agent loop.
 * Carries raw LLM usage + the list of tools invoked in that step.
 * Pricing (roubles, rates, per-tool prices) is the caller's concern — not the core's.
 */
export interface StepUsageReport {
  /** Zero-based index of the step, as reported by the AI SDK. Stable across Restate replays.
   *  Use it to build a deterministic ctx.run key for idempotent debiting. */
  step: number;
  llm: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Real USD cost as reported by the provider (e.g. OpenRouter with usage.include).
     *  0 when the provider did not include cost information. */
    costUsd: number;
    /** Wire model id actually used by the provider for this step. */
    model: string;
  };
  /** Distinct tools called in this step, with call counts. Empty array when no tools ran. */
  tools: { name: string; calls: number }[];
}

export interface ChatFilePart {
  mediaType: string;
  url: string;
}

export interface ChatRequest {
  message?: string;
  files?: ChatFilePart[];
  replyTo?: DeliveryTarget;
  /** Stable user identifier for long-term memory scoping. Falls back to sessionId if omitted. */
  userId?: string;
}

/** Public handler surface exposed to Restate and typed ingress clients. */
export interface AgentHandlers {
  chat(ctx: ObjectContext, req: ChatRequest): Promise<{ messageId: string }>;
  reset(ctx: ObjectContext): Promise<{ ok: boolean }>;
}

export interface GenerateInput {
  ctx: ObjectContext;
  model: LanguageModelV3;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxSteps: number;
  emitToolEvent: (event: WireEvent) => void;
  onUsage?: (ctx: ObjectContext, report: StepUsageReport) => Promise<void>;
}

export interface GenerateOutput {
  text: string;
  reasoningText?: string;
  response: { messages: ModelMessage[] };
}

export interface AgentObjectConfig {
  systemPrompt?: string;
  tools?: AgentTool[];
  model: LanguageModelV3;
  maxSteps?: number;
  delivery?: DeliveryAdapter;
  memory?: MemoryAdapter;
  /**
   * Real-time side-channel for intermediate agent events (tokens, tool I/O, reasoning).
   * Defaults to NoopStreamAdapter (events discarded). Supply PubsubStreamAdapter for web
   * clients, or a custom adapter for other channels (e.g. MAX messenger push).
   */
  stream?: StreamAdapter;
  /**
   * Server-side metering callback, invoked once per completed agent step.
   * The billing context wraps any side effects (debits) in ctx.run using
   * `report.step` as part of the idempotency key — Restate guarantees
   * exactly-once execution even on replay.
   *
   * Never called for browser/pubsub delivery — usage never reaches the client.
   */
  onUsage?: (ctx: ObjectContext, report: StepUsageReport) => Promise<void>;
}

/** Structural contract restate.object() reads from its config argument. */
interface RestateVirtualObjectConfig {
  readonly name: string;
  readonly handlers: AgentHandlers;
  readonly options?: ObjectOptions;
}

/** Abstract base class for agent Virtual Objects. */
export abstract class AgentObject implements RestateVirtualObjectConfig {
  abstract readonly name: string;

  protected readonly systemPrompt: string;
  protected readonly tools: AgentTool[];
  protected readonly model: LanguageModelV3;
  protected readonly maxSteps: number;
  protected readonly delivery: DeliveryAdapter;
  protected readonly memory: MemoryAdapter;
  protected readonly stream: StreamAdapter;
  protected readonly onUsage?: (ctx: ObjectContext, report: StepUsageReport) => Promise<void>;

  protected constructor(config: AgentObjectConfig) {
    this.systemPrompt = config.systemPrompt ?? "";
    this.tools = config.tools ?? [];
    this.model = config.model;
    this.maxSteps = config.maxSteps ?? 20;
    this.delivery = config.delivery ?? new NoopDeliveryAdapter();
    this.memory = config.memory ?? createMemoryAdapter();
    this.stream = config.stream ?? new NoopStreamAdapter();
    this.onUsage = config.onUsage;
  }

  // Restate does Object.entries(config.handlers) — getter returns only bound methods, not the full instance.
  get handlers(): AgentHandlers {
    return { chat: this.chat.bind(this), reset: this.reset.bind(this) };
  }

  async chat(ctx: ObjectContext, req: ChatRequest): Promise<{ messageId: string }> {
    const message = req?.message ?? "";
    const replyTo = req?.replyTo;
    // userId scopes long-term memory across sessions; falls back to Virtual Object key (sessionId).
    const userId = req?.userId ?? ctx.key;
    const history: ModelMessage[] = (await ctx.get<ModelMessage[]>("history")) ?? [];

    const fileParts = (req?.files ?? []).map((f) => {
      const base64 = f.url.includes(",") ? f.url.split(",")[1] : f.url;
      return { type: "image" as const, image: base64, mimeType: f.mediaType };
    });
    const userContent = fileParts.length > 0
      ? [{ type: "text" as const, text: message }, ...fileParts]
      : message;
    history.push({ role: "user", content: userContent });

    // Recall relevant long-term memories and inject them ephemerally (not stored in history).
    const memories = await this.memory.recall(ctx, userId, message);
    const messagesWithMemory: ModelMessage[] = memories.length > 0
      ? [
          {
            role: "system",
            content: `Relevant memories about this user:\n${memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
          },
          ...history,
        ]
      : history;

    const emitToolEvent = (event: WireEvent) => this.stream.emit(ctx, replyTo, event);

    let replyContent = "";
    try {
      const { text, reasoningText, response } = await this.durableGenerate({
        ctx,
        model: this.model,
        system: this.systemPrompt,
        messages: messagesWithMemory,
        tools: Object.fromEntries(this.tools.map((t) => [t.name, t.build(ctx)])) as ToolSet,
        maxSteps: this.maxSteps,
        emitToolEvent,
        onUsage: this.onUsage,
      });
      if (reasoningText) {
        emitToolEvent({ kind: "reasoning", text: reasoningText });
      }
      history.push(...response.messages);
      ctx.set("history", history);
      replyContent = text;

      // Persist the exchange to long-term memory; Mem0 decides what's worth keeping.
      await this.memory.remember(ctx, userId, [
        { role: "user", content: message },
        { role: "assistant", content: text },
      ]);
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      replyContent = "The model is temporarily unavailable (rate-limit or upstream error). Please try again.";
    }

    const reply: OutboxMessage = {
      id: ctx.rand.uuidv4(),
      role: "assistant",
      content: replyContent,
      ts: await ctx.date.now(),
    };

    await this.delivery.deliver(ctx, { target: replyTo, message: reply });
    return { messageId: reply.id };
  }

  async reset(ctx: ObjectContext): Promise<{ ok: boolean }> {
    ctx.clear("history");
    return { ok: true };
  }

  protected async durableGenerate({ ctx, model, system, messages, tools, maxSteps, emitToolEvent, onUsage }: GenerateInput): Promise<GenerateOutput> {
    const durableModel = wrapLanguageModel({
      model,
      middleware: [durableCalls(ctx, LLM_RETRY_OPTIONS), errorClassifierMiddleware],
    });
    return generateText({
      model: durableModel,
      system,
      messages,
      tools,
      stopWhen: [stepCountIs(maxSteps)],
      // Ask OpenRouter (and compatible providers) to include real USD cost in metadata.
      providerOptions: {
        openrouter: { usage: { include: true } },
      },
      onStepFinish: onUsage
        ? async (step) => {
            // Build tool call counts for this step.
            const toolCountMap = new Map<string, number>();
            for (const tc of step.toolCalls) {
              toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
            }
            const stepTools = Array.from(toolCountMap.entries()).map(([name, calls]) => ({ name, calls }));

            // Extract provider-reported cost (OpenRouter sets providerMetadata.openrouter.usage.cost).
            const openrouterMeta = step.providerMetadata?.openrouter as
              | { usage?: { cost?: number } }
              | undefined;
            const costUsd = openrouterMeta?.usage?.cost ?? 0;

            const report: StepUsageReport = {
              step: step.stepNumber,
              llm: {
                // AI SDK v6 renamed promptTokens→inputTokens, completionTokens→outputTokens.
                // We normalise to the conventional names used by billing callers.
                promptTokens: step.usage.inputTokens ?? 0,
                completionTokens: step.usage.outputTokens ?? 0,
                totalTokens: step.usage.totalTokens ?? 0,
                costUsd,
                model: step.model.modelId,
              },
              tools: stepTools,
            };

            await onUsage(ctx, report);
          }
        : undefined,
      experimental_onToolCallStart: ({ toolCall }) => {
        emitToolEvent({
          kind: "tool-input",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input: (toolCall as any).input,
        });
      },
      experimental_onToolCallFinish: (event) => {
        if (event.success) {
          emitToolEvent({
            kind: "tool-output",
            toolCallId: event.toolCall.toolCallId,
            toolName: event.toolCall.toolName,
            output: event.output,
          });
        } else {
          emitToolEvent({
            kind: "tool-error",
            toolCallId: event.toolCall.toolCallId,
            toolName: event.toolCall.toolName,
            errorText: String(event.error),
          });
        }
      },
    });
  }
}
