import type { ObjectContext } from "@restatedev/restate-sdk";
import { DeliveryAdapter, PubsubChannelBase } from "./base.ts";
import type { DeliveryPayload, WireEvent } from "./base.ts";

export class WebDeliveryAdapter extends PubsubChannelBase implements DeliveryAdapter {
  async deliver(ctx: ObjectContext, { target, message }: DeliveryPayload): Promise<void> {
    const topic = this.resolveWebTopic(target);
    if (!topic) return;
    this.publish(ctx, topic, { kind: "text", text: message.content } as WireEvent);
    this.publish(ctx, topic, { kind: "done", id: message.id } as WireEvent);
  }
}
