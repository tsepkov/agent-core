import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const DEFAULT_MODEL = "google/gemma-3-27b-it:free";

/** Resolve the model slug from the environment (override per fork via OPENROUTER_MODEL). */
export function resolveModelId() {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

/** Build the LLM model handle used by the agent loop. OpenAI-compatible via OpenRouter. */
export function getModel() {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  return openrouter.chat(resolveModelId());
}
