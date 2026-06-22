import * as restate from "@restatedev/restate-sdk";
import type { ObjectContext, ObjectSharedContext } from "@restatedev/restate-sdk";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { durableCalls } from "@restatedev/vercel-ai-middleware";
import { createDeliveryAdapter } from "./delivery.ts";
import type { AgentTool } from "./tool.ts";
import type { DeliveryAdapter, DeliveryTarget, OutboxMessage } from "./delivery.ts";

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

interface PullRequest {
  cursor?: number;
}

interface PullResponse {
  messages: OutboxMessage[];
  cursor: number;
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

/**
 * Default durable generate: wrap the model with Restate's `durableCalls` middleware so every LLM
 * call is journaled (restored on retries), then run the AI SDK's native tool-calling loop. Tools
 * make their own steps durable via `ctx.run` (see {@link defineTool}). Injectable for unit tests.
 */
async function durableGenerate({ ctx, model, system, messages, tools, maxSteps }: GenerateInput): Promise<GenerateOutput> {
  const durableModel = wrapLanguageModel({
    model,
    middleware: durableCalls(ctx, { maxRetryAttempts: 3 }),
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
 *
 * Kept separate from {@link createAgent} so the loop can be unit-tested with a fake context and
 * an injected `generate` (no network, no Restate runtime). Operational chat history lives strictly
 * in Restate KV; LLM durability comes from the `durableCalls` middleware.
 *
 * Delivery is decoupled from the HTTP request: on serverless the gateway invokes `chat` one-way
 * and the connection is gone before the durable loop finishes. The final reply is (a) appended to
 * a durable per-session `outbox` (read back via `pull`) and (b) pushed through the
 * {@link createDeliveryAdapter} `deliver` hook (live channel, e.g. Telegram or pub/sub).
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
    /**
     * Invoked one-way by the gateway (`/chat/send`); returns immediately with a `messageId`
     * instead of holding the connection. `req.replyTo = { channel, address }` tells `deliver`
     * where to push.
     */
    async chat(ctx: ObjectContext, req: ChatRequest) {
      const message = req?.message ?? "";
      const replyTo = req?.replyTo;
      const history: ModelMessage[] = (await ctx.get<ModelMessage[]>("history")) ?? [];
      history.push({ role: "user", content: message });

      const { text, response } = await generate({
        ctx,
        model,
        system: systemPrompt,
        messages: history,
        // Tools are bound to this invocation's context (closure over ctx).
        tools: Object.fromEntries(tools.map((t) => [t.name, t.build(ctx)])) as ToolSet,
        maxSteps: maxSteps ?? 5,
      });

      history.push(...response.messages);
      ctx.set("history", history);

      const reply: OutboxMessage = {
        id: ctx.rand.uuidv4(),
        role: "assistant",
        content: text,
        ts: await ctx.date.now(),
      };

      // Durable source of truth for pull-based catch-up (browser refresh/reconnect).
      const outbox: OutboxMessage[] = (await ctx.get<OutboxMessage[]>("outbox")) ?? [];
      outbox.push(reply);
      ctx.set("outbox", outbox);

      // Push path: durable, retried if the channel fails (no-op unless the fork wires a transport).
      await ctx.run("deliver", () => delivery.deliver(ctx, { target: replyTo, message: reply }));

      return { messageId: reply.id };
    },

    /**
     * Shared (concurrent-read) handler: returns outbox messages after `cursor` plus the new cursor.
     * Clients call this on (re)connect to catch up on anything missed by the live channel.
     */
    pull: restate.handlers.object.shared(async (ctx: ObjectSharedContext, req: PullRequest): Promise<PullResponse> => {
      const cursor = req?.cursor ?? 0;
      const outbox: OutboxMessage[] = (await ctx.get<OutboxMessage[]>("outbox")) ?? [];
      return { messages: outbox.slice(cursor), cursor: outbox.length };
    }),

    async reset(ctx: ObjectContext) {
      ctx.clear("history");
      ctx.clear("outbox");
      return { ok: true };
    },
  };
}

/**
 * Create a durable agent as a Restate Virtual Object, keyed per session/tenant.
 *
 * @param config.name          Virtual Object name (ingress path segment)
 * @param config.systemPrompt
 * @param config.tools         tools built with {@link defineTool}
 * @param config.model         base LLM model handle (see {@link getModel})
 * @param config.maxSteps
 */
export function createAgent(config: AgentConfig) {
  return restate.object({
    name: config.name,
    handlers: createAgentHandlers(config),
  });
}
