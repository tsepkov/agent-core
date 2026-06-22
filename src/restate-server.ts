// Standalone h2c Restate endpoint for local development.
// Restate runtime connects via HTTP/2 cleartext (h2c prior-knowledge) — Next.js dev server
// does not support h2c, so this separate server is needed in development.
// Production uses src/app/restate/[[...slug]]/route.ts (HTTP/2 via TLS).

// Load .env once at the entry point so every module picks up the variables.
// In Docker/Compose the env is injected via env_file, so a missing .env is silently ignored.
try { process.loadEnvFile(); } catch { /* absent in Docker/CI */ }

import { endpoint } from "@restatedev/restate-sdk";
import { createPubsubObject } from "@restatedev/pubsub";
import { manager } from "./agents/manager.ts";

const pubsub = createPubsubObject("pubsub");
const PORT = Number(process.env.RESTATE_AGENT_PORT ?? 9080);
endpoint().bind(manager).bind(pubsub).listen(PORT);
