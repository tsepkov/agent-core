import { tool } from "ai";
import type { Tool } from "ai";
import type { ObjectContext } from "@restatedev/restate-sdk";
import { z } from "zod";

interface ToolConfig<TInput extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: TInput;
  execute(args: { ctx: ObjectContext; input: z.infer<TInput>; idempotencyKey?: string }): Promise<unknown>;
  durable?: boolean;
  mutating?: boolean;
}

export interface AgentTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build(ctx: ObjectContext): Tool<any, any>;
}

/**
 * Define an agent tool whose side effect runs as an isolated, checkpointed Restate step.
 *
 * Returns a small wrapper with a `build(ctx)` factory: the agent loop binds each tool to the
 * current invocation context, producing a native Vercel AI SDK tool whose `execute` is made
 * durable via `ctx.run`. The AI SDK drives the tool-calling loop; Restate makes each step
 * replay-safe.
 *
 * @param durable  wrap `execute` in `ctx.run` (use false for tools that make native Restate
 *                 calls, e.g. spawning a subagent)
 * @param mutating inject a deterministic idempotency key for write operations
 */
export function defineTool<TInput extends z.ZodType>(cfg: ToolConfig<TInput>): AgentTool {
  const { name, description, inputSchema, execute, durable = true, mutating = false } = cfg;
  return {
    name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build(ctx: ObjectContext): Tool<any, any> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tool({
        description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: inputSchema as z.ZodType<any>,
        execute: async (input: z.infer<TInput>): Promise<unknown> => {
          // Deterministic idempotency key from workflow state, for mutating writes.
          const idempotencyKey = mutating ? ctx.rand.uuidv4() : undefined;
          const run = (): Promise<unknown> => execute({ ctx, input, idempotencyKey });
          // Plain side effects get their own checkpointed step; Restate-native tools (already
          // journaled, e.g. ctx.objectClient calls) opt out via `durable: false`.
          return durable ? ctx.run(name, run) : run();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as Tool<any, any>;
    },
  };
}
