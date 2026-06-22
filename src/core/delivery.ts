import type { ObjectContext } from "@restatedev/restate-sdk";

export interface DeliveryTarget {
  channel?: string;
  address?: string;
}

export interface OutboxMessage {
  id: string;
  role: string;
  content: string;
  ts: number;
}

export interface DeliveryPayload {
  target?: DeliveryTarget;
  message: OutboxMessage;
}

export interface DeliveryAdapter {
  deliver(ctx: ObjectContext, payload: DeliveryPayload): Promise<void>;
}

export type WireEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool-input"; toolCallId: string; toolName: string }
  | { kind: "tool-output"; toolCallId: string; toolName: string }
  | { kind: "tool-error"; toolCallId: string; toolName: string; errorText: string }
  | { kind: "done"; id: string };

/**
 * Response delivery adapter (channel dispatch).
 */
export function createDeliveryAdapter(overrides: Partial<DeliveryAdapter> = {}): DeliveryAdapter {
  return {
    async deliver(_ctx, _payload) {
      // no-op by default
    },
    ...overrides,
  };
}

/**
 * Delivery adapter that publishes replies to Restate pub/sub word-by-word.
 */
export function createWebDeliveryAdapter(pubsubName = "pubsub"): DeliveryAdapter {
  const publish = createPubsubPublisher(pubsubName);
  return {
    async deliver(ctx, { target, message }) {
      if (target?.channel !== "web") return;
      const topic = target.address ?? "";
      if (!topic) return;
      // Split into word-level chunks.
      const chunks = message.content.match(/\S+\s*/g) ?? [message.content];
      for (const chunk of chunks) {
        publish(ctx, topic, { kind: "text", delta: chunk } as WireEvent);
      }
      publish(ctx, topic, { kind: "done", id: message.id } as WireEvent);
    },
  };
}
