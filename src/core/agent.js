import * as restate from "@restatedev/restate-sdk";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import { durableCalls } from "@restatedev/vercel-ai-middleware";

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
 */
export function createAgentHandlers({
  systemPrompt = "",
  tools = [],
  model,
  maxSteps = 5,
  generate = durableGenerate,
}) {
  return {
    async chat(ctx, req) {
      const message = req?.message ?? "";
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
      return { text };
    },

    async reset(ctx) {
      ctx.clear("history");
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
