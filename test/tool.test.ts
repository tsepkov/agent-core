import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineTool } from "../src/core/index.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";
import type { ToolExecutionOptions } from "ai";

const fakeOptions = { toolCallId: "t1", messages: [] } as ToolExecutionOptions;

function fakeCtx(overrides: object = {}): ObjectContext {
  return {
    rand: { uuidv4: () => "idem-123" },
    run(_name: string, fn: () => Promise<unknown>) {
      return fn();
    },
    ...overrides,
  } as unknown as ObjectContext;
}

test("defineTool exposes a name and a build(ctx) factory", () => {
  const t = defineTool({
    name: "ping",
    description: "ping something",
    inputSchema: z.object({ host: z.string() }),
    execute: async () => "pong",
  });

  assert.equal(t.name, "ping");
  assert.equal(typeof t.build, "function");
  const built = t.build(fakeCtx());
  assert.equal(typeof built.execute, "function");
});

test("durable tool runs its side effect inside ctx.run", async () => {
  const ran: string[] = [];
  const ctx = fakeCtx({
    run(name: string, fn: () => Promise<unknown>) {
      ran.push(name);
      return fn();
    },
  });

  const built = defineTool({
    name: "save",
    description: "save",
    inputSchema: z.object({ value: z.number() }),
    execute: async ({ input }) => input.value * 2,
  }).build(ctx);

  const out = await built.execute!({ value: 21 }, fakeOptions);
  assert.equal(out, 42);
  assert.deepEqual(ran, ["save"]);
});

test("non-durable tool bypasses ctx.run (for native Restate calls)", async () => {
  let usedRun = false;
  const ctx = fakeCtx({
    run() {
      usedRun = true;
    },
  });

  const built = defineTool({
    name: "delegate",
    description: "delegate",
    inputSchema: z.object({}),
    durable: false,
    execute: async () => "ok",
  }).build(ctx);

  const out = await built.execute!({}, fakeOptions);
  assert.equal(out, "ok");
  assert.equal(usedRun, false);
});

test("mutating tool injects a deterministic idempotency key", async () => {
  let seenKey: string | undefined;
  const built = defineTool({
    name: "write",
    description: "write",
    inputSchema: z.object({}),
    mutating: true,
    execute: async ({ idempotencyKey }) => {
      seenKey = idempotencyKey;
      return "written";
    },
  }).build(fakeCtx());

  await built.execute!({}, fakeOptions);
  assert.equal(seenKey, "idem-123");
});
