import { createPubsubPublisher } from "@restatedev/pubsub";
import type { DeliveryAdapter } from "./delivery.ts";

/**
 * Delivery adapter that publishes replies to Restate pub/sub word-by-word.
 * The web chat route subscribes to a per-turn topic and streams each chunk as a UIMessage
 * text-delta, giving the browser a progressive streaming appearance.
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
