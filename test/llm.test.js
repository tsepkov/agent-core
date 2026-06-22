import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelId } from "../src/core/llm.js";

test("resolveModelId falls back to the default free model", () => {
  const prev = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  try {
    assert.equal(resolveModelId(), "google/gemma-3-27b-it:free");
  } finally {
    if (prev !== undefined) process.env.OPENROUTER_MODEL = prev;
  }
});

test("resolveModelId honors OPENROUTER_MODEL override", () => {
  const prev = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
  try {
    assert.equal(resolveModelId(), "anthropic/claude-3.5-sonnet");
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = prev;
  }
});
