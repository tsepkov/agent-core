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

export type WireEvent =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-input"; toolCallId: string; toolName: string; input: unknown }
  | { kind: "tool-output"; toolCallId: string; toolName: string; output: unknown }
  | { kind: "tool-error"; toolCallId: string; toolName: string; errorText: string }
  | { kind: "done"; id: string };

export abstract class DeliveryAdapter {
  abstract deliver(ctx: ObjectContext, payload: DeliveryPayload): Promise<void>;
}

export class NoopDeliveryAdapter extends DeliveryAdapter {
  async deliver(_ctx: ObjectContext, _payload: DeliveryPayload): Promise<void> {}
}

/**
 * Base for adapters that publish to a Restate pubsub topic keyed by channel address.
 * Encapsulates publisher construction and the web-channel topic resolution that
 * WebDeliveryAdapter and PubsubStreamAdapter both need.
 */
export abstract class PubsubChannelBase {
  protected readonly publish: ReturnType<typeof createPubsubPublisher>;

  constructor(pubsubName = "pubsub") {
    this.publish = createPubsubPublisher(pubsubName);
  }

  /** Returns the pubsub topic string when target is a "web" channel, otherwise null. */
  protected resolveWebTopic(target: DeliveryTarget | undefined): string | null {
    if (target?.channel !== "web") return null;
    const topic = target.address ?? "";
    return topic || null;
  }
}
