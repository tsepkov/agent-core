import { createAgent } from "../core/agent.ts";
import { getModel } from "../core/llm.ts";

/**
 * The single agent of the scaffold. Built from the reusable {@link createAgent} factory; a durable
 * Virtual Object keyed per session (history lives in Restate KV). Add tools via `tools: [...]` and
 * {@link defineTool} as use-cases grow.
 */
export const manager = createAgent({
  name: "Manager",
  systemPrompt: "You are a helpful manager agent. Answer the user clearly and concisely.",
  model: getModel(),
});
