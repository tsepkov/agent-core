import { z } from "zod";
import { defineTool } from "../../core/tool.ts";

export const getDatetimeTool = defineTool({
  name: "get_datetime",
  description: "Get the current date and time in ISO 8601 format.",
  inputSchema: z.object({}),
  execute: async ({ ctx }) => {
    const timestamp = await ctx.date.now();
    return new Date(timestamp).toISOString();
  },
  // ctx.date.now() is already a durable Restate journal entry — wrapping it in
  // ctx.run() would create a nested Restate call, which causes journal replay mismatches.
  durable: false,
});
