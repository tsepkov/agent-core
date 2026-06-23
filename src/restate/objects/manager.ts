import * as restate from "@restatedev/restate-sdk";
import { AgentObject } from "@/core/agent";
import { WebDeliveryAdapter } from "@/core/delivery";
import { getModel } from "@/core/llm";
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
}

export const manager = restate.object(new ManagerObject());
