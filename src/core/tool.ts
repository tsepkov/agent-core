import { tool } from "ai";
import type { Tool } from "ai";
import type { ObjectContext } from "@restatedev/restate-sdk";
import { z } from "zod";

interface ToolConfig<TInput extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: z.ZodType;
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
 */
export function defineTool<TInput extends z.ZodType>(cfg: ToolConfig<TInput>): AgentTool {
  const { name, description, inputSchema, outputSchema, execute, durable = true, mutating = false } = cfg;
  return {
    name,
    build(ctx: ObjectContext): Tool<z.infer<TInput>, unknown> {
      return tool({
        description,
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        execute: async (input: z.infer<TInput>): Promise<unknown> => {
          const idempotencyKey = mutating ? ctx.rand.uuidv4() : undefined;
          const run = () => execute({ ctx, input, idempotencyKey });
          return durable ? ctx.run(name, run) : run();
        },
      });
    },
  };
}
