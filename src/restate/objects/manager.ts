import * as restate from "@restatedev/restate-sdk";
import { AgentObject } from "@/core/agent";
import { WebDeliveryAdapter } from "@/core/delivery";
import { getModel } from "@/core/llm";
import { createToolSignalHooksProvider } from "@/core/hooks";
import { webSearchTool } from "@/tools/web-search/index";
import { getDatetimeTool } from "@/tools/datetime/index";

const tools = [webSearchTool, getDatetimeTool];

class ManagerObject extends AgentObject {
  readonly name = "manager";

  constructor() {
    super({
      systemPrompt: "You are a helpful manager agent. Answer the user clearly and concisely.",
      tools,
      model: getModel(),
      delivery: new WebDeliveryAdapter(),
    });
  }

  get options() {
    return {
      hooks: [
        createToolSignalHooksProvider({
          pubsubName: "pubsub",
          ingressUrl: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
          toolNames: new Set(tools.map((t) => t.name)),
        }),
      ],
    };
  }
}

export const manager = restate.object(new ManagerObject());
