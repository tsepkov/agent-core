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

/**
 * Response delivery adapter (channel dispatch).
 */
export function createDeliveryAdapter(overrides: Partial<DeliveryAdapter> = {}): DeliveryAdapter {
  return {
    async deliver(_ctx, _payload) {
      // no-op by default — forks dispatch by `target.channel` to web/telegram/pub-sub.
    },
    ...overrides,
  };
}
