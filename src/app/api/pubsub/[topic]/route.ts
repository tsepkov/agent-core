import { createPubsubClient } from "@restatedev/pubsub-client";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pubsub = createPubsubClient({
  url: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
  name: "pubsub",
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ topic: string }> }
) {
  const { topic } = await params;
  const raw = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(raw) ? raw : 0;
  const stream = pubsub.sse({ topic, offset, signal: request.signal });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
