import type { ObjectContext } from "@restatedev/restate-sdk";
import { createPubsubPublisher } from "@restatedev/pubsub";
import type { DeliveryTarget, WireEvent } from "./base.ts";

/**
 * Real-time side-channel for intermediate agent events (tokens, tool I/O, reasoning).
 * Distinct from DeliveryAdapter, which handles final message delivery.
 * Implement this to route the agent's live event stream to any channel.
 */
export abstract class StreamAdapter {
  abstract emit(ctx: ObjectContext, target: DeliveryTarget | undefined, event: WireEvent): void;
}

/** Default no-op: intermediate events are silently discarded. */
export class NoopStreamAdapter extends StreamAdapter {
  emit(): void {}
}

/** Streams intermediate WireEvents into a Restate pubsub topic for web clients. */
export class PubsubStreamAdapter extends StreamAdapter {
  private readonly publish: ReturnType<typeof createPubsubPublisher>;

  constructor(pubsubName = "pubsub") {
    super();
    this.publish = createPubsubPublisher(pubsubName);
  }

  emit(ctx: ObjectContext, target: DeliveryTarget | undefined, event: WireEvent): void {
    if (target?.channel !== "web") return;
    const topic = target.address ?? "";
    if (!topic) return;
    this.publish(ctx, topic, event);
  }
}
