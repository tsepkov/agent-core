import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AgentTool } from "../src/core/tool/index.ts";
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

test("AgentTool exposes a name and a build(ctx) factory", () => {
  class PingTool extends AgentTool<z.ZodObject<{ host: z.ZodString }>> {
    readonly name = "ping";
    readonly description = "ping something";
    readonly inputSchema = z.object({ host: z.string() });
    async execute(): Promise<unknown> { return "pong"; }
  }

  const t = new PingTool();
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

  class SaveTool extends AgentTool<z.ZodObject<{ value: z.ZodNumber }>> {
    readonly name = "save";
    readonly description = "save";
    readonly inputSchema = z.object({ value: z.number() });
    async execute({ input }: { ctx: ObjectContext; input: { value: number } }): Promise<unknown> {
      return input.value * 2;
    }
  }

  const built = new SaveTool().build(ctx);
  const out = await built.execute!({ value: 21 }, fakeOptions);
  assert.equal(out, 42);
  assert.deepEqual(ran, ["save"]);
});

test("non-durable tool bypasses ctx.run (for native Restate calls)", async () => {
  let usedRun = false;
  const ctx = fakeCtx({
    run() { usedRun = true; },
  });

  class DelegateTool extends AgentTool<z.ZodObject<Record<string, never>>> {
    readonly name = "delegate";
    readonly description = "delegate";
    readonly inputSchema = z.object({});
    readonly durable = false;
    async execute(): Promise<unknown> { return "ok"; }
  }

  const out = await new DelegateTool().build(ctx).execute!({}, fakeOptions);
  assert.equal(out, "ok");
  assert.equal(usedRun, false);
});

test("mutating tool injects a deterministic idempotency key", async () => {
  let seenKey: string | undefined;

  class WriteTool extends AgentTool<z.ZodObject<Record<string, never>>> {
    readonly name = "write";
    readonly description = "write";
    readonly inputSchema = z.object({});
    readonly mutating = true;
    async execute({ idempotencyKey }: { ctx: ObjectContext; input: object; idempotencyKey?: string }): Promise<unknown> {
      seenKey = idempotencyKey;
      return "written";
    }
  }

  await new WriteTool().build(fakeCtx()).execute!({}, fakeOptions);
  assert.equal(seenKey, "idem-123");
});
