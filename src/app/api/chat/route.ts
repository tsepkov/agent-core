import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";
import { connect, rpc } from "@restatedev/restate-sdk-clients";
import { createPubsubClient } from "@restatedev/pubsub-client";
import { manager } from "@/agents/manager";
import { WireEvent } from "@/core/delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

const INGRESS = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";
const DEADLINE_MS = (maxDuration - 5) * 1000;

export async function POST(req: Request): Promise<Response> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await req.json()) as Record<string, any>;
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

        let responseText: string | null = null;

        try {
          for await (const msg of pubsubClient.pull({ topic: turnTopic, offset: 0, signal: ac.signal })) {
            const event = msg as WireEvent;

            if (event.kind === "tool-input") {
              writer.write({
                type: "tool-input-available",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: {},
              });
            } else if (event.kind === "tool-output") {
              writer.write({
                type: "tool-output-available",
                toolCallId: event.toolCallId,
                output: null,
              });
            } else if (event.kind === "tool-error") {
              writer.write({
                type: "tool-output-error",
                toolCallId: event.toolCallId,
                errorText: event.errorText,
              });
            } else if (event.kind === "text") {
              responseText = event.text;
            } else if (event.kind === "done") {
              break;
            }
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === "AbortError")) throw err;
          responseText = "(Agent timeout — try again or check Restate logs.)";
        } finally {
          clearTimeout(deadline);
          ac.abort();
        }

        if (responseText !== null) {
          writer.write({ type: "text-start", id: textId });
          writer.write({ type: "text-delta", id: textId, delta: responseText });
          writer.write({ type: "text-end", id: textId });
        }
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
