import test from "node:test";
import assert from "node:assert/strict";
import { OpenRouterLLMProvider } from "../src/index.ts";

test("OpenRouterLLMProvider picks up OPENROUTER_MODEL from env", () => {
  const prev = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
  try {
    const provider = new OpenRouterLLMProvider();
    assert.equal(provider.modelId, "anthropic/claude-3.5-sonnet");
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = prev;
  }
});

test("OpenRouterLLMProvider accepts explicit modelId over env", () => {
  const provider = new OpenRouterLLMProvider("key", "openai/gpt-4o");
  assert.equal(provider.modelId, "openai/gpt-4o");
});
