import { createAgent, getModel, createWebDeliveryAdapter } from "../core/index.ts";
import { webSearchTool } from "../tools/web-search/index.ts";

/**
 * The single agent of the scaffold. Built from the reusable {@link createAgent} factory.
 */
export const manager = createAgent({
  name: "Manager",
  systemPrompt: "You are a helpful manager agent. Answer the user clearly and concisely.",
  model: getModel(),
  tools: [webSearchTool],
  delivery: createWebDeliveryAdapter(),
});
