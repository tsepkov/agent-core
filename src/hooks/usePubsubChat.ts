"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPubsubClient } from "@restatedev/pubsub-client";
import type { UIMessage, DynamicToolUIPart } from "ai";
import type { WireEvent } from "@/core/delivery";
import { getOrCreateUserId } from "@/lib/sessions";

const INGRESS = process.env.NEXT_PUBLIC_RESTATE_INGRESS_URL ?? "http://localhost:8080";

export type PubsubChatStatus = "ready" | "submitted";

export function usePubsubChat({
  sessionId,
  initialMessages,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
}) {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [status, setStatus] = useState<PubsubChatStatus>("ready");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (!text.trim()) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const messageId = crypto.randomUUID();
      const userMsg: UIMessage = {
        id: messageId,
        role: "user",
        parts: [{ type: "text", text }],
      };
      setMessages((prev) => [...prev, userMsg]);
      setStatus("submitted");

      let topic: string;
      try {
        const userId = getOrCreateUserId();
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: text, messageId, userId }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        ({ topic } = await res.json());
      } catch (err) {
        if (!ac.signal.aborted) {
          appendErrorMessage(setMessages, String(err));
          setStatus("ready");
        }
        return;
      }

      const assistantId = crypto.randomUUID();
      const toolParts = new Map<string, DynamicToolUIPart>();
      let responseText: string | null = null;
      let reasoningText: string | null = null;

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", parts: [] },
      ]);

      const pubsub = createPubsubClient({ url: INGRESS, name: "pubsub" });

      try {
        for await (const raw of pubsub.pull({ topic, offset: 0, signal: ac.signal })) {
          const event = raw as WireEvent;

          if (event.kind === "tool-input") {
            toolParts.set(event.toolCallId, {
              type: "dynamic-tool",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              state: "input-available",
              input: event.input,
            });
          } else if (event.kind === "tool-output") {
            const prev = toolParts.get(event.toolCallId);
            if (prev) {
              toolParts.set(event.toolCallId, {
                ...prev,
                state: "output-available",
                output: event.output,
              } as DynamicToolUIPart);
            }
          } else if (event.kind === "tool-error") {
            const prev = toolParts.get(event.toolCallId);
            if (prev) {
              toolParts.set(event.toolCallId, {
                ...prev,
                state: "output-error",
                errorText: event.errorText,
              } as DynamicToolUIPart);
            }
          } else if (event.kind === "reasoning") {
            reasoningText = event.text;
          } else if (event.kind === "text") {
            responseText = event.text;
          } else if (event.kind === "done") {
            break;
          }

          setMessages((prev) => buildAssistantMessage(prev, assistantId, toolParts, reasoningText, responseText));
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        responseText = `(Ошибка: ${String(err)})`;
      }

      setMessages((prev) => buildAssistantMessage(prev, assistantId, toolParts, reasoningText, responseText));
      if (!ac.signal.aborted) setStatus("ready");
    },
    [sessionId],
  );

  return { messages, sendMessage, status };
}

function buildAssistantMessage(
  messages: UIMessage[],
  assistantId: string,
  toolParts: Map<string, DynamicToolUIPart>,
  reasoning: string | null,
  text: string | null,
): UIMessage[] {
  return messages.map((m) => {
    if (m.id !== assistantId) return m;
    const parts: UIMessage["parts"] = [];
    if (reasoning !== null) parts.push({ type: "reasoning", text: reasoning });
    parts.push(...toolParts.values());
    if (text !== null) parts.push({ type: "text", text });
    return { ...m, parts };
  });
}

function appendErrorMessage(
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>,
  text: string,
) {
  setMessages((prev) => [
    ...prev,
    { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text }] },
  ]);
}
