import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelId } from "../src/index.ts";

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
