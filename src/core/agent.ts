import * as restate from "@restatedev/restate-sdk";
import type { ObjectContext } from "@restatedev/restate-sdk";
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

async function durableGenerate({ ctx, model, system, messages, tools, maxSteps }: GenerateInput): Promise<GenerateOutput> {
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

export interface AgentObjectConfig {
  systemPrompt?: string;
  tools?: AgentTool[];
  model: LanguageModelV3;
  maxSteps?: number;
  delivery?: DeliveryAdapter;
  generate?: (input: GenerateInput) => Promise<GenerateOutput>;
}

/**
 * Base class for Restate Virtual Object agents.
 * Uses JS native private fields (`#`) so Restate's handler discovery skips them —
 * only `chat` and `reset` are enumerable on the instance.
 */
export class AgentObject {
  readonly #systemPrompt: string;
  readonly #tools: AgentTool[];
  readonly #model: LanguageModelV3;
  readonly #maxSteps: number;
  readonly #delivery: DeliveryAdapter;
  readonly #generate: (input: GenerateInput) => Promise<GenerateOutput>;

  constructor(config: AgentObjectConfig) {
    this.#systemPrompt = config.systemPrompt ?? "";
    this.#tools = config.tools ?? [];
    this.#model = config.model;
    this.#maxSteps = config.maxSteps ?? 5;
    this.#delivery = config.delivery ?? createDeliveryAdapter();
    this.#generate = config.generate ?? durableGenerate;
  }

  chat = async (ctx: ObjectContext, req: ChatRequest): Promise<{ messageId: string }> => {
    const message = req?.message ?? "";
    const replyTo = req?.replyTo;
    const history: ModelMessage[] = (await ctx.get<ModelMessage[]>("history")) ?? [];
    history.push({ role: "user", content: message });

    let replyContent = "";
    try {
      const { text, response } = await this.#generate({
        ctx,
        model: this.#model,
        system: this.#systemPrompt,
        messages: history,
        tools: Object.fromEntries(this.#tools.map((t) => [t.name, t.build(ctx)])) as ToolSet,
        maxSteps: this.#maxSteps,
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

    await this.#delivery.deliver(ctx, { target: replyTo, message: reply });
    return { messageId: reply.id };
  }

  reset = async (ctx: ObjectContext): Promise<{ ok: boolean }> => {
    ctx.clear("history");
    return { ok: true };
  };
}
