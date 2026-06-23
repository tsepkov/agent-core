import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryAdapter, createWebDeliveryAdapter } from "../src/core/delivery.ts";
import type { DeliveryPayload } from "../src/core/delivery.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";

test("default adapter exposes a no-op deliver", async () => {
  const adapter = createDeliveryAdapter();
  assert.equal(typeof adapter.deliver, "function");
  // No-op resolves without throwing and returns nothing.
  assert.equal(
    await adapter.deliver({} as ObjectContext, { message: { id: "x", role: "assistant", content: "x", ts: 0 } }),
    undefined
  );
});

test("override replaces deliver and receives the ctx and payload", async () => {
  const seen: Array<{ ctx: ObjectContext; payload: DeliveryPayload }> = [];
  const adapter = createDeliveryAdapter({
    deliver: async (ctx, payload) => {
      seen.push({ ctx, payload });
    },
  });

  const ctx = { key: "session-1" } as unknown as ObjectContext;
  const payload: DeliveryPayload = {
    target: { channel: "telegram", address: "42" },
    message: { id: "1", role: "assistant", content: "hi", ts: 0 },
  };
  await adapter.deliver(ctx, payload);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].ctx, ctx);
  assert.deepEqual(seen[0].payload, payload);
});

test("createWebDeliveryAdapter is exported as a function", async () => {
  // createWebDeliveryAdapter publishes a single complete `text` event
  // followed by a `done` event — no word-by-word chunking.
  assert.equal(typeof createWebDeliveryAdapter, "function");
});
