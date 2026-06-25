import * as restate from "@restatedev/restate-sdk";
import type { ObjectContext, ObjectOptions } from "@restatedev/restate-sdk";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import type { ModelMessage, ToolSet, UserContent } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { durableCalls } from "@restatedev/vercel-ai-middleware";
import { NoopDeliveryAdapter, NoopStreamAdapter } from "./delivery/index.ts";
import type { AgentTool } from "./tool.ts";
import type { DeliveryAdapter, DeliveryTarget, OutboxMessage, WireEvent } from "./delivery/index.ts";
import type { StreamAdapter } from "./delivery/index.ts";
import { ProviderErrorClassifier, LLM_RETRY_OPTIONS } from "./retry.ts";
import { MemoryAdapter } from "./memory.ts";

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

/**
 * Aggregated result returned by {@link AgentObject.runLoop}.
 * Includes the full text reply, optional reasoning, the AI SDK message history
 * for the completed steps, and usage totals accumulated across all steps.
 */
export interface LoopResult {
  text: string;
  reasoningText?: string;
  response: { messages: ModelMessage[] };
  /** Usage totals accumulated across every step in the loop. */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Sum of provider-reported USD cost across all steps (0 when provider omits cost). */
    costUsd: number;
    /** Model id reported by the provider on the last step. */
    model: string;
  };
}

/**
 * Minimal generate result shape used by {@link AgentObject.onAfterGenerate}.
 * A subset of {@link LoopResult} kept for backward compatibility.
 */
export interface GenerateOutput {
  text: string;
  reasoningText?: string;
  response: { messages: ModelMessage[] };
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

export interface AgentObjectConfig {
  systemPrompt?: string;
  tools?: AgentTool[];
  /**
   * Base language model. Optional when the subclass overrides {@link AgentObject.resolveModel}.
   * Required otherwise — the base resolveModel throws if this is absent.
   */
  model?: LanguageModelV3;
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
  /**
   * Error classification strategy for LLM provider calls.
   * Defaults to `ProviderErrorClassifier`. Override to customise retry/terminal
   * semantics for a specific provider (different header names, custom status codes, etc.).
   */
  errorClassifier?: ProviderErrorClassifier;
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
  protected readonly model?: LanguageModelV3;
  protected readonly maxSteps: number;
  protected readonly delivery: DeliveryAdapter;
  protected readonly memory: MemoryAdapter;
  protected readonly stream: StreamAdapter;
  protected readonly onUsage?: (ctx: ObjectContext, report: StepUsageReport) => Promise<void>;
  protected readonly errorClassifier: ProviderErrorClassifier;

  protected constructor(config: AgentObjectConfig) {
    this.systemPrompt = config.systemPrompt ?? "";
    this.tools = config.tools ?? [];
    this.model = config.model;
    this.maxSteps = config.maxSteps ?? 20;
    this.delivery = config.delivery ?? new NoopDeliveryAdapter();
    this.memory = config.memory ?? MemoryAdapter.fromEnv();
    this.stream = config.stream ?? new NoopStreamAdapter();
    this.onUsage = config.onUsage;
    this.errorClassifier = config.errorClassifier ?? new ProviderErrorClassifier();
  }

  // Restate does Object.entries(config.handlers) — getter returns only bound methods, not the full instance.
  get handlers(): AgentHandlers {
    return { chat: this.chat.bind(this), reset: this.reset.bind(this) };
  }

  /**
   * Resolve the language model for this request.
   * Base implementation returns the model from config; throws if none was provided.
   * Override to select the model dynamically per-request (e.g. from a registry + user credentials).
   */
  protected resolveModel(_ctx: ObjectContext, _req: ChatRequest): LanguageModelV3 {
    if (!this.model) {
      throw new Error(
        "AgentObject: no model configured. Either pass model in AgentObjectConfig or override resolveModel().",
      );
    }
    return this.model;
  }

  /**
   * Return the tools available for this request.
   * Base implementation returns the tools from config.
   * Override to inject per-request context (credentials, ids, accumulators) into tool instances.
   */
  protected buildTools(_ctx: ObjectContext, _req: ChatRequest): AgentTool[] {
    return this.tools;
  }

  /**
   * Convert raw file attachments from the wire request into AI SDK content parts.
   * Override to add pre-processing (OCR, compression, format conversion, etc.).
   */
  protected buildUserContent(
    message: string,
    files: ChatFilePart[],
  ): UserContent {
    const parts = files.map((f) => {
      const base64 = f.url.includes(",") ? f.url.split(",")[1] : f.url;
      if (f.mediaType.startsWith("image/")) {
        return { type: "image" as const, image: base64, mimeType: f.mediaType };
      }
      return { type: "file" as const, data: base64, mediaType: f.mediaType };
    });
    return parts.length > 0
      ? [{ type: "text" as const, text: message }, ...parts]
      : message;
  }

  /**
   * Called after the LLM finishes and the reply is ready, before delivery.
   * Override to add post-processing, logging, analytics, etc.
   * The base implementation is a no-op.
   */
  protected async onAfterGenerate(
    _ctx: ObjectContext,
    _req: ChatRequest,
    _output: GenerateOutput,
  ): Promise<void> {}

  /**
   * Build the user-facing error reply when the LLM call fails terminally.
   * Override to localise the message or include a support reference ID.
   */
  protected getErrorReply(_err: restate.TerminalError): string {
    return "The model is temporarily unavailable (rate-limit or upstream error). Please try again.";
  }

  async chat(ctx: ObjectContext, req: ChatRequest): Promise<{ messageId: string }> {
    const message = req?.message ?? "";
    const replyTo = req?.replyTo;
    // userId scopes long-term memory across sessions; falls back to Virtual Object key (sessionId).
    const userId = req?.userId ?? ctx.key;
    const history: ModelMessage[] = (await ctx.get<ModelMessage[]>("history")) ?? [];

    history.push({ role: "user", content: this.buildUserContent(message, req?.files ?? []) });

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

    const model = this.resolveModel(ctx, req);
    const toolInstances = this.buildTools(ctx, req);
    const tools = Object.fromEntries(toolInstances.map((t) => [t.name, t.build(ctx)])) as ToolSet;

    let replyContent = "";
    try {
      const output = await this.runLoop({
        ctx,
        model,
        system: this.systemPrompt,
        messages: messagesWithMemory,
        tools,
        maxSteps: this.maxSteps,
        emitToolEvent,
        onUsage: this.onUsage,
      });
      const { text, reasoningText, response } = output;
      if (reasoningText) {
        emitToolEvent({ kind: "reasoning", text: reasoningText });
      }
      history.push(...response.messages);
      ctx.set("history", history);
      replyContent = text;

      await this.onAfterGenerate(ctx, req, output);

      // Persist the exchange to long-term memory; Mem0 decides what's worth keeping.
      await this.memory.remember(ctx, userId, [
        { role: "user", content: message },
        { role: "assistant", content: text },
      ]);
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      replyContent = this.getErrorReply(err);
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

  /**
   * Run the durable multi-step LLM loop using the Vercel AI SDK + Restate durableCalls.
   *
   * Each LLM call is checkpointed as a Restate journal entry via the durableCalls middleware.
   * Tool executions are checkpointed inside AgentTool.build via ctx.run.
   * The loop continues until the model produces a final text reply or maxSteps is reached.
   *
   * Returns a {@link LoopResult} with the reply text and usage totals accumulated across all
   * steps — use these for billing, logging, and history persistence.
   *
   * Override this method in tests to inject a stub instead of hitting a real LLM.
   */
  protected async runLoop({
    ctx,
    model,
    system,
    messages,
    tools,
    maxSteps,
    emitToolEvent,
    onUsage,
  }: GenerateInput): Promise<LoopResult> {
    const durableModel = wrapLanguageModel({
      model,
      middleware: [durableCalls(ctx, LLM_RETRY_OPTIONS), this.errorClassifier.buildMiddleware()],
    });

    // Accumulate usage totals across steps for the returned LoopResult.
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostUsd = 0;
    let lastModelId = "";

    const result = await generateText({
      model: durableModel,
      system,
      messages,
      tools,
      stopWhen: [stepCountIs(maxSteps)],
      // Ask OpenRouter (and compatible providers) to include real USD cost in metadata.
      providerOptions: {
        openrouter: { usage: { include: true } },
      },
      onStepFinish: async (step) => {
        // Extract provider-reported cost (OpenRouter sets providerMetadata.openrouter.usage.cost).
        const openrouterMeta = step.providerMetadata?.openrouter as
          | { usage?: { cost?: number } }
          | undefined;
        const costUsd = openrouterMeta?.usage?.cost ?? 0;

        // Accumulate for LoopResult.usage.
        totalPromptTokens += step.usage.inputTokens ?? 0;
        totalCompletionTokens += step.usage.outputTokens ?? 0;
        totalCostUsd += costUsd;
        lastModelId = step.model?.modelId ?? lastModelId;

        // Fire per-step callback when provided (e.g. for real-time billing or logging).
        if (onUsage) {
          const toolCountMap = new Map<string, number>();
          for (const tc of step.toolCalls) {
            toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
          }
          const stepTools = Array.from(toolCountMap.entries()).map(([name, calls]) => ({ name, calls }));

          const report: StepUsageReport = {
            step: step.stepNumber,
            llm: {
              // AI SDK v6 renamed promptTokens→inputTokens, completionTokens→outputTokens.
              // We normalise to the conventional names used by billing callers.
              promptTokens: step.usage.inputTokens ?? 0,
              completionTokens: step.usage.outputTokens ?? 0,
              totalTokens: step.usage.totalTokens ?? 0,
              costUsd,
              model: step.model?.modelId ?? "",
            },
            tools: stepTools,
          };

          await onUsage(ctx, report);
        }
      },
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

    return {
      text: result.text,
      reasoningText: result.reasoning ?? undefined,
      response: result.response,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        costUsd: totalCostUsd,
        model: lastModelId,
      },
    };
  }
}
