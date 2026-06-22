/**
 * Chat bridge: translates useChat (streaming) into Restate one-way send + pubsub streaming.
 *
 * Flow:
 *   1. Read last user message text and sessionId from request body.
 *   2. Submit the message one-way to the durable agent via SDK client (idempotent).
 *   3. Subscribe to a per-turn pubsub topic (idempotencyKey) from offset 0.
 *      The delivery adapter publishes word-level chunks there as the LLM finishes.
 *   4. Stream each word chunk as a UIMessageStream text-delta so useChat shows tokens
 *      appearing progressively. Break on the 'done' sentinel.
 *
 * Per-turn topics eliminate the baseline-cursor problem: each turn always starts from offset 0.
 * On Restate replay the pubsub publishes are journaled and NOT re-sent, so reconnects get all
 * words from the existing topic immediately.
 */
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";
import { connect, rpc } from "@restatedev/restate-sdk-clients";
import { createPubsubClient } from "@restatedev/pubsub-client";
import { manager } from "@/agents/manager";

export const runtime = "nodejs";
export const maxDuration = 60;

const INGRESS = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";
const DEADLINE_MS = (maxDuration - 5) * 1000;

export async function POST(req: Request): Promise<Response> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await req.json()) as Record<string, any>;
    // useChat sends { id } = the chat id we set to sessionId; we also accept explicit sessionId.
    const sessionId: string = body.sessionId ?? body.id ?? "";
    const messages: Array<{ role: string; id: string; parts?: Array<{ type: string; text?: string }> }> =
      body.messages ?? [];

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text =
      lastUser?.parts?.find((p) => p.type === "text")?.text?.trim() ?? "";

    if (!text || !sessionId) {
      return new Response("sessionId and a non-empty user message are required", {
        status: 400,
      });
    }

    const ingress = connect({ url: INGRESS });
    const pubsubClient = createPubsubClient(ingress, { name: "pubsub" });

    // Per-turn topic: each chat turn gets its own fresh pubsub topic so we always
    // subscribe from offset 0 with no baseline cursor alignment needed.
    const idempotencyKey = lastUser?.id
      ? `${sessionId}-${lastUser.id}`
      : `${sessionId}-${randomUUID()}`;
    const turnTopic = idempotencyKey;

    await ingress.objectSendClient(manager, sessionId).chat(
      { message: text, replyTo: { channel: "web", address: turnTopic } },
      rpc.sendOpts({ idempotencyKey }),
    );

    const ac = new AbortController();
    const deadline = setTimeout(() => ac.abort(), DEADLINE_MS);

    const textId = randomUUID();
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id: textId });

        try {
          for await (const msg of pubsubClient.pull({ topic: turnTopic, offset: 0, signal: ac.signal })) {
            const event = msg as { type?: string; delta?: string };
            if (event.delta !== undefined) {
              writer.write({ type: "text-delta", id: textId, delta: event.delta });
            } else if (event.type === "done") {
              break;
            }
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === "AbortError")) throw err;
          writer.write({ type: "text-delta", id: textId, delta: "(Agent timeout — try again or check Restate logs.)" });
        } finally {
          clearTimeout(deadline);
          ac.abort();
        }

        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    console.error("[api/chat] unhandled error:", err);
    return new Response(
      err instanceof Error ? err.message : String(err),
      { status: 500 }
    );
  }
}
