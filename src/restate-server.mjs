// Standalone h2c Restate endpoint for local development.
// Restate runtime connects via HTTP/2 cleartext (h2c prior-knowledge) — Next.js dev server
// does not support h2c, so this separate server is needed on port 9080.
// Production uses src/app/restate/[[...slug]]/route.ts instead (REQUEST_RESPONSE over HTTPS).
import { endpoint } from "@restatedev/restate-sdk";
import { manager } from "./agents/manager.js";

const PORT = Number(process.env.RESTATE_AGENT_PORT ?? 9080);
endpoint().bind(manager).listen(PORT);
