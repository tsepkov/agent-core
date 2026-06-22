import * as restate from "@restatedev/restate-sdk";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import { durableCalls } from "@restatedev/vercel-ai-middleware";
import { createDeliveryAdapter } from "./delivery.js";

/**
 * Default durable generate: wrap the model with Restate's `durableCalls` middleware so every LLM
 * call is journaled (restored on retries), then run the AI SDK's native tool-calling loop. Tools
 * make their own steps durable via `ctx.run` (see {@link defineTool}). Injectable for unit tests.
 */
async function durableGenerate({ ctx, model, system, messages, tools, maxSteps }) {
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
 * Kept separate from {@link createAgent} so the loop can be unit-tested with a fake context and an
 * injected `generate` (no network, no Restate runtime). Operational chat history lives strictly in
 * Restate KV (CORE.md §A); LLM durability comes from the `durableCalls` middleware.
 *
 * Delivery is decoupled from the HTTP request: on serverless the gateway invokes `chat` one-way and
 * the connection is gone before the durable loop finishes. The final reply is therefore (a) appended
 * to a durable per-session `outbox` (read back via `pull` — the reliable source of truth) and
 * (b) pushed through the {@link createDeliveryAdapter} `deliver` hook (live channel, e.g. Telegram or
 * a pub/sub publish). Both run for every agent, independent of prompt/tools.
 */
export function createAgentHandlers({
  systemPrompt = "",
  tools = [],
  model,
  maxSteps = 5,
  generate = durableGenerate,
  delivery = createDeliveryAdapter(),
}) {
  return {
    /**
     * Invoked one-way by the gateway (`/chat/send`); returns immediately with a `messageId` instead
     * of holding the connection. `req.replyTo = { channel, address }` tells `deliver` where to push.
     */
    async chat(ctx, req) {
      const message = req?.message ?? "";
      const replyTo = req?.replyTo;
      const history = (await ctx.get("history")) ?? [];
      history.push({ role: "user", content: message });

      const { text, response } = await generate({
        ctx,
        model,
        system: systemPrompt,
        messages: history,
        // Tools are bound to this invocation's context (closure over ctx).
        tools: Object.fromEntries(tools.map((t) => [t.name, t.build(ctx)])),
        maxSteps,
      });

      history.push(...response.messages);
      ctx.set("history", history);

      const reply = { id: ctx.rand.uuidv4(), role: "assistant", content: text, ts: ctx.date.now() };

      // Durable source of truth for pull-based catch-up (browser refresh/reconnect).
      const outbox = (await ctx.get("outbox")) ?? [];
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
    pull: restate.handlers.object.shared(async (ctx, req) => {
      const cursor = req?.cursor ?? 0;
      const outbox = (await ctx.get("outbox")) ?? [];
      return { messages: outbox.slice(cursor), cursor: outbox.length };
    }),

    async reset(ctx) {
      ctx.clear("history");
      ctx.clear("outbox");
      return { ok: true };
    },
  };
}

/**
 * Create a durable agent as a Restate Virtual Object, keyed per session/tenant.
 *
 * @param {object} config
 * @param {string} config.name           Virtual Object name (ingress path segment)
 * @param {string} [config.systemPrompt]
 * @param {Array}  [config.tools]        tools built with {@link defineTool}
 * @param {any}    config.model          base LLM model handle (see {@link getModel})
 * @param {number} [config.maxSteps]
 */
export function createAgent(config) {
  return restate.object({
    name: config.name,
    handlers: createAgentHandlers(config),
  });
}
