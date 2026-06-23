import { connect, rpc } from "@restatedev/restate-sdk-clients";
import { manager } from "@/restate/objects/manager";

export const runtime = "nodejs";

const INGRESS = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    sessionId?: string;
    message?: string;
    messageId?: string;
    userId?: string;
  };
  const { sessionId, message, messageId, userId } = body;

  if (!sessionId || !message?.trim()) {
    return new Response("sessionId and message are required", { status: 400 });
  }

  const idempotencyKey = messageId ? `${sessionId}-${messageId}` : `${sessionId}-${crypto.randomUUID()}`;
  const topic = idempotencyKey;

  const ingress = connect({ url: INGRESS });
  await ingress.objectSendClient(manager, sessionId).chat(
    {
      message: message.trim(),
      replyTo: { channel: "web", address: topic },
      userId: userId ?? sessionId,
    },
    rpc.sendOpts({ idempotencyKey }),
  );

  return Response.json({ topic });
}
