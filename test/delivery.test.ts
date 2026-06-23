import test from "node:test";
import assert from "node:assert/strict";
import { NoopDeliveryAdapter, WebDeliveryAdapter, DeliveryAdapter } from "../src/core/delivery/index.ts";
import type { DeliveryPayload } from "../src/core/delivery/index.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";

test("NoopDeliveryAdapter.deliver resolves without throwing", async () => {
  const adapter = new NoopDeliveryAdapter();
  assert.equal(typeof adapter.deliver, "function");
  assert.equal(
    await adapter.deliver({} as ObjectContext, { message: { id: "x", role: "assistant", content: "x", ts: 0 } }),
    undefined
  );
});

test("DeliveryAdapter subclass receives the ctx and payload", async () => {
  const seen: Array<{ ctx: ObjectContext; payload: DeliveryPayload }> = [];

  class RecordingAdapter extends DeliveryAdapter {
    async deliver(ctx: ObjectContext, payload: DeliveryPayload): Promise<void> {
      seen.push({ ctx, payload });
    }
  }

  const adapter = new RecordingAdapter();
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

test("WebDeliveryAdapter is instantiable", async () => {
  const adapter = new WebDeliveryAdapter();
  assert.ok(adapter instanceof DeliveryAdapter);
  assert.equal(typeof adapter.deliver, "function");
});
