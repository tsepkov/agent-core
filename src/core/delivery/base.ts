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

export type WireEvent =
  | { kind: "text"; text: string }
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
