import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModelV3 } from "@ai-sdk/provider";

/** Abstract factory for language model handles. Override to support providers other than OpenRouter. */
export abstract class LLMProvider {
  abstract getModel(): LanguageModelV3;

  /** Select backend from environment variables. Currently always returns OpenRouterLLMProvider. */
  static fromEnv(): LLMProvider {
    return new OpenRouterLLMProvider();
  }
}

/** OpenRouter-backed provider. Reads OPENROUTER_API_KEY and OPENROUTER_MODEL from env. */
export class OpenRouterLLMProvider extends LLMProvider {
  /** The model slug passed to OpenRouter (e.g. "anthropic/claude-3.5-sonnet"). */
  readonly modelId: string;
  private readonly apiKey: string;

  constructor(
    apiKey = process.env.OPENROUTER_API_KEY!,
    modelId = process.env.OPENROUTER_MODEL!,
  ) {
    super();
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  getModel(): LanguageModelV3 {
    return createOpenRouter({ apiKey: this.apiKey }).chat(this.modelId);
  }
}
