import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModelV3 } from "@ai-sdk/provider";

/** Resolve the model slug from the environment (override per fork via OPENROUTER_MODEL). */
export function resolveModelId(): string {
  return process.env.OPENROUTER_MODEL!;
}

/** Build the LLM model handle used by the agent loop. OpenAI-compatible via OpenRouter. */
export function getModel(): LanguageModelV3 {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  return openrouter.chat(resolveModelId());
}
