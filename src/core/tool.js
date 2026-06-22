import { tool } from "ai";

/**
 * Define an agent tool whose side effect runs as an isolated, checkpointed Restate step (CORE.md §B).
 *
 * Returns a small wrapper with a `build(ctx)` factory: the agent loop binds each tool to the current
 * invocation context, producing a native Vercel AI SDK tool whose `execute` is made durable via
 * `ctx.run`. The AI SDK drives the tool-calling loop; Restate makes each step replay-safe.
 *
 * @param {object} cfg
 * @param {string} cfg.name             unique tool name surfaced to the LLM
 * @param {string} cfg.description      natural-language description for the model
 * @param {import("zod").ZodTypeAny} cfg.inputSchema  zod schema for the tool arguments
 * @param {(args: { ctx: any, input: any, idempotencyKey?: string }) => Promise<any>} cfg.execute
 * @param {boolean} [cfg.durable=true]  wrap `execute` in `ctx.run` (use false for tools that make
 *                                      native Restate calls, e.g. spawning a subagent)
 * @param {boolean} [cfg.mutating=false] inject a deterministic idempotency key for write operations
 */
export function defineTool({
  name,
  description,
  inputSchema,
  execute,
  durable = true,
  mutating = false,
}) {
  return {
    name,
    build(ctx) {
      return tool({
        description,
        inputSchema,
        execute: async (input) => {
          // Deterministic idempotency key from workflow state, for mutating writes.
          const idempotencyKey = mutating ? ctx.rand.uuidv4() : undefined;
          const run = () => execute({ ctx, input, idempotencyKey });
          // Plain side effects get their own checkpointed step; Restate-native tools (already
          // journaled, e.g. ctx.objectClient calls) opt out via `durable: false`.
          return durable ? ctx.run(name, run) : run();
        },
      });
    },
  };
}
