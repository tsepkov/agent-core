"use client";

import { useRef } from "react";
import {
  useLocalRuntime,
  useThreadListItemRuntime,
  type AssistantRuntime,
  type ChatModelAdapter,
  type ThreadListItemRuntime,
  type ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import { createPubsubClient } from "@restatedev/pubsub-client";
import type { WireEvent } from "@/core/delivery";
import { getOrCreateUserId } from "@/lib/sessions";

const INGRESS = process.env.NEXT_PUBLIC_RESTATE_INGRESS_URL ?? "http://localhost:8080";

function makeRestateAdapter(threadListItemRef: { current: ThreadListItemRuntime | null }): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      // Extract text from the last user message in the thread.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text = (lastUser?.content ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");

      // Use the thread's stable remoteId as the Restate session key.
      // initialize() is idempotent — returns the same remoteId on every call.
      const threadListItem = threadListItemRef.current;
      if (!threadListItem) throw new Error("ThreadListItemRuntime not available");
      const { remoteId: sessionId } = await threadListItem.initialize();

      const messageId = crypto.randomUUID();
      const userId = getOrCreateUserId();

      // Dispatch to Restate via BFF — returns { topic }.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, messageId, userId }),
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`Chat API error: ${await res.text()}`);
      const { topic } = (await res.json()) as { topic: string };

      // Pull WireEvents from Restate pubsub directly — no proxy function needed.
      const pubsub = createPubsubClient({ url: INGRESS, name: "pubsub" });

      // Accumulators — same logic as the old usePubsubChat, but we yield
      // ChatModelRunResult snapshots instead of building UIMessage manually.
      const tools = new Map<string, ThreadAssistantMessagePart & { type: "tool-call" }>();
      let reasoningText = "";
      let responseText = "";

      for await (const raw of pubsub.pull({ topic, offset: 0, signal: abortSignal })) {
        const event = raw as WireEvent;

        if (event.kind === "tool-input") {
          tools.set(event.toolCallId, {
            type: "tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            // WireEvent.input is `unknown`; cast to ReadonlyJSONObject (the runtime
            // type for tool args). Restate serialises args as plain JSON, so this is safe.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args: event.input as any,
            argsText: JSON.stringify(event.input),
          });
        } else if (event.kind === "tool-output") {
          const prev = tools.get(event.toolCallId);
          if (prev) tools.set(event.toolCallId, { ...prev, result: event.output });
        } else if (event.kind === "tool-error") {
          const prev = tools.get(event.toolCallId);
          if (prev) tools.set(event.toolCallId, { ...prev, result: event.errorText, isError: true });
        } else if (event.kind === "reasoning") {
          reasoningText = event.text;
        } else if (event.kind === "text") {
          responseText = event.text;
        } else if (event.kind === "done") {
          break;
        }

        // Yield full snapshot on every event — assistant-ui diffs internally.
        const content: ThreadAssistantMessagePart[] = [];
        if (reasoningText) content.push({ type: "reasoning", text: reasoningText });
        for (const t of tools.values()) content.push(t);
        if (responseText) content.push({ type: "text", text: responseText });

        yield { content };
      }
    },
  };
}

/**
 * Wraps the Restate pubsub transport as a LocalRuntime ChatModelAdapter.
 *
 * Called as `runtimeHook` inside useRemoteThreadListRuntime — no props needed.
 * Session ID comes from the current thread's remoteId (stable across reloads),
 * which maps to the same Restate Virtual Object so durable runs continue.
 *
 * History (message persistence) is handled by the thread-list adapter's
 * ThreadHistoryAdapter; this hook only drives the live pubsub transport.
 */
export function useRestateRuntime(): AssistantRuntime {
  // Capture the current ThreadListItemRuntime in a ref so the adapter closure
  // (created once via useMemo inside useLocalRuntime) can read the latest value.
  const threadListItem = useThreadListItemRuntime();
  const threadListItemRef = useRef<ThreadListItemRuntime | null>(null);
  threadListItemRef.current = threadListItem;

  const adapterRef = useRef<ChatModelAdapter | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = makeRestateAdapter(threadListItemRef);
  }

  return useLocalRuntime(adapterRef.current);
}
