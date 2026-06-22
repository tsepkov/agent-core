/**
 * Response delivery adapter (channel dispatch).
 *
 * On serverless the gateway invokes the agent one-way and the HTTP connection is gone before the
 * durable loop finishes, so the response is delivered out-of-band. Delivery has two sides of the same
 * mechanism, selected by the request's gateway:
 *   - push  — the handler itself pushes the result into a channel (e.g. Telegram sendMessage, or a
 *             managed pub/sub publish for the browser);
 *   - pull  — the client polls the agent's durable outbox on reconnect/refresh (see agent `pull`).
 *
 * This is the *push* interface. `deliver` receives `{ target, message }` where `target = { channel,
 * address }` describes where the reply should go; the channel selects the transport. The scaffold
 * ships a no-op default (like {@link createMemoryAdapter}); forks plug concrete web/telegram deliverers
 * without leaking transport specifics into the abstract core.
 */
export function createDeliveryAdapter(overrides = {}) {
  return {
    /**
     * @param {any} _ctx  Restate ObjectContext (deliver runs inside a durable `ctx.run` step)
     * @param {{ target?: { channel?: string, address?: string }, message: object }} _payload
     */
    async deliver(_ctx, _payload) {
      // no-op by default — forks dispatch by `target.channel` to web/telegram/pub-sub.
    },
    ...overrides,
  };
}
