import { tool } from "ai";
import type { Tool } from "ai";
import type { ObjectContext } from "@restatedev/restate-sdk";
import { z } from "zod";

export abstract class AgentTool<TInput extends z.ZodType = z.ZodType> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: TInput;
  readonly outputSchema?: z.ZodType;
  readonly durable: boolean = true;
  readonly mutating: boolean = false;

  abstract execute(args: {
    ctx: ObjectContext;
    input: z.infer<TInput>;
    idempotencyKey?: string;
  }): Promise<unknown>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build(ctx: ObjectContext): Tool<any, any> {
    return tool({
      description: this.description,
      inputSchema: this.inputSchema,
      ...(this.outputSchema ? { outputSchema: this.outputSchema } : {}),
      execute: async (input: z.infer<TInput>): Promise<unknown> => {
        const idempotencyKey = this.mutating ? ctx.rand.uuidv4() : undefined;
        const run = () => this.execute({ ctx, input, idempotencyKey });
        return this.durable ? ctx.run(this.name, run) : run();
      },
    });
  }
}
