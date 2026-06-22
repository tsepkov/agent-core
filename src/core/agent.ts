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

type GenerateFn = (input: GenerateInput) => Promise<GenerateOutput>;

interface ChatRequest {
  message?: string;
  replyTo?: DeliveryTarget;
}

export interface AgentHandlersConfig {
  systemPrompt?: string;
  tools?: AgentTool[];
  model: LanguageModelV3;
  maxSteps?: number;
  generate?: GenerateFn;
  delivery?: DeliveryAdapter;
}

export interface AgentConfig extends AgentHandlersConfig {
  name: string;
}

async function getHistory(ctx: ObjectContext): Promise<ModelMessage[]> {
  return (await ctx.get<ModelMessage[]>("history")) ?? [];
}

async function updateHistory(ctx: ObjectContext, history: ModelMessage[]): Promise<void> {
  ctx.set("history", history);
}

/**
 * Default durable generate: wrap the model with Restate's `durableCalls` middleware so every LLM
 * call is journaled (restored on retries), then run the AI SDK's native tool-calling loop. Tools
 * make their own steps durable via `ctx.run` (see {@link defineTool}). Injectable for unit tests.
 */
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

/**
 * Build the durable agent-loop handlers for a Restate Virtual Object.
 */
export function createAgentHandlers({
  systemPrompt = "",
  tools = [],
  model,
  maxSteps = 5,
  generate = durableGenerate,
  delivery = createDeliveryAdapter(),
}: AgentHandlersConfig) {
  return {
    async chat(ctx: ObjectContext, req: ChatRequest) {
      const message = req?.message ?? "";
      const replyTo = req?.replyTo;
      const history = await getHistory(ctx);
      history.push({ role: "user", content: message });

      let replyContent = "";
      try {
        const { text, response } = await generate({
          ctx,
          model,
          system: systemPrompt,
          messages: history,
          tools: Object.fromEntries(tools.map((t) => [t.name, t.build(ctx)])) as ToolSet,
          maxSteps: maxSteps ?? 5,
        });

        await updateHistory(ctx, [...history, ...response.messages]);
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

      await delivery.deliver(ctx, { target: replyTo, message: reply });
      return { messageId: reply.id };
    },

    async reset(ctx: ObjectContext) {
      ctx.clear("history");
      return { ok: true };
    },
  };
}

/**
 * Create a durable agent as a Restate Virtual Object, keyed per session/tenant.
 */
export function createAgent(config: AgentConfig) {
  return restate.object({
    name: config.name,
    handlers: createAgentHandlers(config),
  });
}
