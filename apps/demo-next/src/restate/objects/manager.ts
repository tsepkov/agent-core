import * as restate from "@restatedev/restate-sdk";
import { AgentObject, type StepUsageReport, WebDeliveryAdapter, PubsubStreamAdapter, getModel, createMemoryAdapter } from "../../../../../packages/agent-core/src/index.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";
import { webSearchTool } from "../../tools/web-search/index";
import { getDatetimeTool } from "../../../../../packages/agent-core/src/tools/datetime/index.ts";

const tools = [webSearchTool, getDatetimeTool];

function logUsage(_ctx: ObjectContext, report: StepUsageReport): Promise<void> {
  const toolSummary = report.tools.length
    ? ` tools=[${report.tools.map((t) => `${t.name}×${t.calls}`).join(", ")}]`
    : "";
  console.log(
    `[usage] step=${report.step} model=${report.llm.model}` +
    ` prompt=${report.llm.promptTokens} completion=${report.llm.completionTokens}` +
    ` total=${report.llm.totalTokens} costUsd=${report.llm.costUsd.toFixed(6)}${toolSummary}`,
  );
  return Promise.resolve();
}

class ManagerObject extends AgentObject {
  readonly name = "manager";

  constructor() {
    super({
      systemPrompt: "You are a helpful manager agent. Answer the user clearly and concisely.",
      tools,
      model: getModel(),
      delivery: new WebDeliveryAdapter(),
      stream: new PubsubStreamAdapter(),
      memory: createMemoryAdapter(),
      onUsage: logUsage,
    });
  }
}

export const manager = restate.object(new ManagerObject());
