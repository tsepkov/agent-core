"use client";

import { useRef } from "react";
import {
  useLocalRuntime,
  useThreadListItemRuntime,
  SimpleImageAttachmentAdapter,
  type AssistantRuntime,
  type ChatModelAdapter,
  type ThreadListItemRuntime,
  type ThreadAssistantMessagePart,
  type CompleteAttachment,
} from "@assistant-ui/react";
import { createPubsubClient } from "@restatedev/pubsub-client";
import type { WireEvent } from "@/core/delivery";
import { getOrCreateUserId } from "@/lib/sessions";

const INGRESS = process.env.NEXT_PUBLIC_RESTATE_INGRESS_URL ?? "http://localhost:8080";

const attachmentAdapter = new SimpleImageAttachmentAdapter();

function makeRestateAdapter(threadListItemRef: { current: ThreadListItemRuntime | null }): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      // Extract text and image attachments from the last user message.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text = (lastUser?.content ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");

      const files = (lastUser?.attachments as readonly CompleteAttachment[] | undefined ?? [])
        .flatMap((att) =>
          (att.content ?? [])
            .filter((p): p is { type: "image"; image: string } => p.type === "image")
            .map((p) => ({ mediaType: att.contentType ?? "image/jpeg", url: p.image as string }))
        );

      // Use the thread's stable remoteId as the Restate session key.
      const threadListItem = threadListItemRef.current;
      if (!threadListItem) throw new Error("ThreadListItemRuntime not available");
      const { remoteId: sessionId } = await threadListItem.initialize();

      const messageId = crypto.randomUUID();
      const userId = getOrCreateUserId();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: text,
          messageId,
          userId,
          ...(files.length > 0 ? { files } : {}),
        }),
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`Chat API error: ${await res.text()}`);
      const { topic } = (await res.json()) as { topic: string };

      const pubsub = createPubsubClient({ url: INGRESS, name: "pubsub" });

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
 * Attachment support: SimpleImageAttachmentAdapter encodes images as data URLs
 * before send(); those are forwarded to /api/chat as ChatRequest.files.
 */
export function useRestateRuntime(): AssistantRuntime {
  const threadListItem = useThreadListItemRuntime();
  const threadListItemRef = useRef<ThreadListItemRuntime | null>(null);
  threadListItemRef.current = threadListItem;

  const adapterRef = useRef<ChatModelAdapter | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = makeRestateAdapter(threadListItemRef);
  }

  return useLocalRuntime(adapterRef.current, {
    adapters: { attachments: attachmentAdapter },
  });
}
