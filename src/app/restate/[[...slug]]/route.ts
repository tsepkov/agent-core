/**
 * Restate service endpoint — this is where the Restate runtime connects to invoke the agent.
 *
 * Clients never call this directly; they send requests to the Restate ingress (compose: :8080)
 * which routes them here via the Restate protocol. Catches all sub-paths:
 *   GET  /restate/discover              → service discovery
 *   POST /restate/invoke/Manager/{handler} → durable handler invocation
 *
 * @see CORE.md §2 "A Next.js API route / handler that acts as a Restate Service"
 */
import { endpoint } from "@restatedev/restate-sdk/fetch";
import { manager } from "@/agents/manager.js";
import { createPubsubObject } from "@restatedev/pubsub";

// Must run on Node.js — Restate SDK uses Node APIs not available on the Edge runtime.
export const runtime = "nodejs";
// Never cache; every request is a live Restate protocol message.
export const dynamic = "force-dynamic";

const pubsub = createPubsubObject("pubsub");
const { fetch: restateHandler } = endpoint().bind(manager).bind(pubsub).handler();

export { restateHandler as GET, restateHandler as POST };
