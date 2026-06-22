/**
 * Chat bridge: translates useChat (streaming) into Restate one-way send + pull.
 *
 * Flow:
 *   1. Read last user message text and sessionId from request body.
 *   2. Snapshot the current outbox cursor (baseline) via pull.
 *   3. Submit the message one-way to the durable agent (chat/send).
 *   4. Poll pull until the agent appends a new reply to the outbox.
 *   5. Return the reply as a UIMessageStream so useChat + AI Elements work natively.
 *
 * No streaming tokens from the LLM — the outbox only holds final replies. The response
 * arrives in one chunk after the agent finishes (which may take several seconds).
 */
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const INGRESS = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";
const POLL_INTERVAL_MS = 700;
const POLL_DEADLINE_MS = (maxDuration - 5) * 1000;

interface OutboxMessage {
  id: string;
  role: string;
  content: string;
  ts: number;
}

async function pull(
  sessionId: string,
  cursor: number
): Promise<{ messages: OutboxMessage[]; cursor: number }> {
  const res = await fetch(`${INGRESS}/Manager/${sessionId}/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cursor }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`pull ${res.status}: ${body}`);
  }
  return res.json() as Promise<{ messages: OutboxMessage[]; cursor: number }>;
}

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

    // Snapshot current cursor so we only wait for the reply to *this* message.
    const { cursor: baseline } = await pull(sessionId, 0);

    const idempotencyKey = lastUser?.id
      ? `${sessionId}-${lastUser.id}`
      : `${sessionId}-${randomUUID()}`;

    const sendRes = await fetch(`${INGRESS}/Manager/${sessionId}/chat/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        message: text,
        replyTo: { channel: "web", address: sessionId },
      }),
    });
    if (!sendRes.ok) {
      const err = await sendRes.text().catch(() => "(unreadable)");
      throw new Error(`chat/send ${sendRes.status}: ${err}`);
    }

    // Poll for the reply.
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let replyText: string | null = null;

    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      const { messages: newMsgs } = await pull(sessionId, baseline);
      if (newMsgs.length > 0) {
        replyText = newMsgs[newMsgs.length - 1].content ?? "";
        break;
      }
    }

    if (replyText === null) {
      replyText = "(Agent timeout — try again or check Restate logs.)";
    }

    const textId = randomUUID();
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: replyText! });
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
