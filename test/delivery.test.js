import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryAdapter } from "../src/core/delivery.js";

test("default adapter exposes a no-op deliver", async () => {
  const adapter = createDeliveryAdapter();
  assert.equal(typeof adapter.deliver, "function");
  // No-op resolves without throwing and returns nothing.
  assert.equal(await adapter.deliver({}, { message: { content: "x" } }), undefined);
});

test("override replaces deliver and receives the ctx and payload", async () => {
  const seen = [];
  const adapter = createDeliveryAdapter({
    deliver: async (ctx, payload) => {
      seen.push({ ctx, payload });
    },
  });

  const ctx = { key: "session-1" };
  const payload = { target: { channel: "telegram", address: "42" }, message: { content: "hi" } };
  await adapter.deliver(ctx, payload);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].ctx, ctx);
  assert.deepEqual(seen[0].payload, payload);
});
