import * as restate from "@restatedev/restate-sdk";
import { AgentObject, type AgentHandlers } from "@/core/agent";
import { createWebDeliveryAdapter } from "@/core/delivery";
import { getModel } from "@/core/llm";
import { createToolSignalHooksProvider } from "@/core/hooks";
import { webSearchTool } from "@/tools/web-search/index";
import { getDatetimeTool } from "@/tools/datetime/index";

const tools = [webSearchTool, getDatetimeTool];

class ManagerObject extends AgentObject {
  constructor() {
    super({
      systemPrompt: "You are a helpful manager agent. Answer the user clearly and concisely.",
      tools,
      model: getModel(),
      delivery: createWebDeliveryAdapter(),
    });
  }
}

export const manager = restate.object({
  name: "manager",
  handlers: new ManagerObject() as AgentHandlers,
  options: {
    hooks: [
      createToolSignalHooksProvider({
        pubsubName: "pubsub",
        ingressUrl: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
        toolNames: new Set(tools.map((t) => t.name)),
      }),
    ],
  },
});
