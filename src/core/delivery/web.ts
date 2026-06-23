import type { ObjectContext } from "@restatedev/restate-sdk";
import { createPubsubPublisher } from "@restatedev/pubsub";
import { DeliveryAdapter } from "./index.ts";
import type { DeliveryPayload, WireEvent } from "./index.ts";

export class WebDeliveryAdapter extends DeliveryAdapter {
  private readonly publish: ReturnType<typeof createPubsubPublisher>;

  constructor(pubsubName = "pubsub") {
    super();
    this.publish = createPubsubPublisher(pubsubName);
  }

  async deliver(ctx: ObjectContext, { target, message }: DeliveryPayload): Promise<void> {
    if (target?.channel !== "web") return;
    const topic = target.address ?? "";
    if (!topic) return;
    this.publish(ctx, topic, { kind: "text", text: message.content } as WireEvent);
    this.publish(ctx, topic, { kind: "done", id: message.id } as WireEvent);
  }
}
