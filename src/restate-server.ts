// Standalone h2c Restate endpoint for local development.
// Restate runtime connects via HTTP/2 cleartext (h2c prior-knowledge) — Next.js dev server
// does not support h2c, so this separate server is needed in development.
// Production uses src/app/restate/[[...slug]]/route.ts (HTTP/2 via TLS).
import { endpoint } from "@restatedev/restate-sdk";
import { createPubsubObject } from "@restatedev/pubsub";
import { manager } from "./agents/manager.ts";

const pubsub = createPubsubObject("pubsub");
const PORT = Number(process.env.RESTATE_AGENT_PORT ?? 9080);
endpoint().bind(manager).bind(pubsub).listen(PORT);
