import { z } from "zod";
import { AgentTool } from "../../tool.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";

const inputSchema = z.object({});

class GetDatetimeTool extends AgentTool<typeof inputSchema> {
  readonly name = "get_datetime";
  readonly description = "Get the current date and time in ISO 8601 format.";
  readonly inputSchema = inputSchema;
  // ctx.date.now() is already a durable Restate journal entry — wrapping it in
  // ctx.run() would create a nested Restate call, which causes journal replay mismatches.
  readonly durable = false;

  async execute({ ctx }: { ctx: ObjectContext; input: z.infer<typeof inputSchema> }): Promise<unknown> {
    const timestamp = await ctx.date.now();
    return new Date(timestamp).toISOString();
  }
}

export const getDatetimeTool = new GetDatetimeTool();
