import type { ObjectContext } from "@restatedev/restate-sdk";
import { createPubsubPublisher } from "@restatedev/pubsub";

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

/**
 * Response delivery adapter (channel dispatch).
 *
 * On serverless the gateway invokes the agent one-way and the HTTP connection is gone before the
 * durable loop finishes, so the response is delivered out-of-band. Delivery has two sides:
 *   - push  — the handler itself pushes the result into a channel (e.g. Telegram, pub/sub);
 *   - pull  — the client polls the agent's durable outbox on reconnect/refresh (see agent `pull`).
 *
 * This is the *push* interface. The scaffold ships a no-op default; forks plug concrete deliverers
 * without leaking transport specifics into the abstract core.
 */
export function createDeliveryAdapter(overrides: Partial<DeliveryAdapter> = {}): DeliveryAdapter {
  return {
    async deliver(_ctx, _payload) {
      // no-op by default — forks dispatch by `target.channel` to web/telegram/pub-sub.
    },
    ...overrides,
  };
}

/**
 * Delivery adapter that publishes replies to Restate pub/sub word-by-word.
 * The web chat route subscribes to a per-turn topic and streams each chunk as a UIMessage
 * text-delta, giving the browser a progressive streaming appearance.
 *
 * @param pubsubName  Name of the registered pubsub Virtual Object (must match the endpoint).
 */
export function createWebDeliveryAdapter(pubsubName = "pubsub"): DeliveryAdapter {
  const publish = createPubsubPublisher(pubsubName);
  return {
    async deliver(ctx, { target, message }) {
      if (target?.channel !== "web") return;
      const topic = target.address ?? "";
      if (!topic) return;
      // Split into word-level chunks so the browser receives tokens progressively.
      const chunks = message.content.match(/\S+\s*/g) ?? [message.content];
      for (const chunk of chunks) {
        publish(ctx, topic, { delta: chunk });
      }
      publish(ctx, topic, { type: "done", id: message.id });
    },
  };
}
