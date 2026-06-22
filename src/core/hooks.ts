import type { HooksProvider } from "@restatedev/restate-sdk";
import { createPubsubClient } from "@restatedev/pubsub-client";
import type { WireEvent } from "./delivery.ts";

export interface ToolSignalHooksOptions {
  pubsubName: string;
  ingressUrl: string;
  toolNames: Set<string>;
}

export function createToolSignalHooksProvider({
  pubsubName,
  ingressUrl,
  toolNames,
}: ToolSignalHooksOptions): HooksProvider {
  return ({ request }) => {
    let topic = "";
    let isWeb = false;

    try {
      const body = JSON.parse(new TextDecoder().decode(request.body));
      const replyTo = body?.replyTo;
      isWeb = replyTo?.channel === "web";
      topic = replyTo?.address ?? "";
    } catch {
      // ignore
    }

    if (!isWeb || !topic) return {};

    const pubsub = createPubsubClient({ url: ingressUrl, name: pubsubName });
    let seq = 0;

    const emit = async (e: WireEvent, key: string) => {
      try {
        await pubsub.publish(topic, e, key);
      } catch (err) {
        console.error("[hooks] failed to publish tool signal:", err);
      }
    };

    return {
      interceptor: {
        run: async (name, next) => {
          if (!toolNames.has(name)) {
            return next();
          }

          const toolCallId = `${request.id}-${name}-${seq++}`;

          await emit({ kind: "tool-input", toolCallId, toolName: name }, `${toolCallId}-in`);

          try {
            await next();
            await emit({ kind: "tool-output", toolCallId, toolName: name }, `${toolCallId}-out`);
          } catch (err) {
            await emit(
              { kind: "tool-error", toolCallId, toolName: name, errorText: String(err) },
              `${toolCallId}-err`
            );
            throw err;
          }
        },
      },
    };
  };
}
