import test from "node:test";
import assert from "node:assert/strict";
import { getDatetimeTool } from "../src/tools/datetime/index.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";
import type { ToolExecutionOptions } from "ai";

const fakeOptions = { toolCallId: "t1", messages: [] } as ToolExecutionOptions;

function fakeCtx(overrides: object = {}): ObjectContext {
  return {
    date: {
      now: async () => 1700000000000, // Fixed timestamp for testing
    },
    run(_name: string, fn: () => Promise<unknown>) {
      return fn();
    },
    ...overrides,
  } as unknown as ObjectContext;
}

test("get_datetime tool returns current time in ISO format", async () => {
  const ctx = fakeCtx();
  const built = getDatetimeTool.build(ctx);

  const result = await built.execute!({}, fakeOptions);

  assert.equal(result, new Date(1700000000000).toISOString());
  assert.match(result as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("get_datetime tool uses ctx.date.now()", async () => {
  let dateNowCalled = false;
  const ctx = fakeCtx({
    date: {
      now: async () => {
        dateNowCalled = true;
        return 1600000000000;
      }
    }
  });

  const built = getDatetimeTool.build(ctx);
  const result = await built.execute!({}, fakeOptions);

  assert.strictEqual(dateNowCalled, true);
  assert.equal(result, new Date(1600000000000).toISOString());
});
