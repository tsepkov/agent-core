import * as restate from "@restatedev/restate-sdk";
import type { ObjectContext, ObjectOptions } from "@restatedev/restate-sdk";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { durableCalls } from "@restatedev/vercel-ai-middleware";
import { createDeliveryAdapter } from "./delivery.ts";
import type { AgentTool } from "./tool.ts";
import type { DeliveryAdapter, DeliveryTarget, OutboxMessage } from "./delivery.ts";
import { errorClassifierMiddleware, LLM_RETRY_OPTIONS } from "./retry.ts";

export interface ChatRequest {
  message?: string;
  replyTo?: DeliveryTarget;
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
}

export interface GenerateOutput {
  text: string;
  response: { messages: ModelMessage[] };
}

export interface AgentObjectConfig {
  systemPrompt?: string;
  tools?: AgentTool[];
  model: LanguageModelV3;
  maxSteps?: number;
  delivery?: DeliveryAdapter;
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

  protected constructor(config: AgentObjectConfig) {
    this.systemPrompt = config.systemPrompt ?? "";
    this.tools = config.tools ?? [];
    this.model = config.model;
    this.maxSteps = config.maxSteps ?? 20;
    this.delivery = config.delivery ?? createDeliveryAdapter();
  }

  // Restate does Object.entries(config.handlers) — getter returns only bound methods, not the full instance.
  get handlers(): AgentHandlers {
    return { chat: this.chat.bind(this), reset: this.reset.bind(this) };
  }

  async chat(ctx: ObjectContext, req: ChatRequest): Promise<{ messageId: string }> {
    const message = req?.message ?? "";
    const replyTo = req?.replyTo;
    const history: ModelMessage[] = (await ctx.get<ModelMessage[]>("history")) ?? [];
    history.push({ role: "user", content: message });

    let replyContent = "";
    try {
      const { text, response } = await this.durableGenerate({
        ctx,
        model: this.model,
        system: this.systemPrompt,
        messages: history,
        tools: Object.fromEntries(this.tools.map((t) => [t.name, t.build(ctx)])) as ToolSet,
        maxSteps: this.maxSteps,
      });
      history.push(...response.messages);
      ctx.set("history", history);
      replyContent = text;
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

  protected async durableGenerate({ ctx, model, system, messages, tools, maxSteps }: GenerateInput): Promise<GenerateOutput> {
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
    });
  }
}
