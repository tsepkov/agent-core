"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Tool, ToolHeader } from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { readMessages, writeMessages } from "@/lib/sessions";
import type { UIMessage, ToolUIPart } from "ai";

export function Chat({ sessionId }: { sessionId: string }) {
  const [initialMessages] = useState<UIMessage[]>(() => readMessages(sessionId));

  const { messages, sendMessage, status } = useChat({
    id: sessionId,
    messages: initialMessages,
  });

  useEffect(() => {
    writeMessages(sessionId, messages);
  }, [sessionId, messages]);

  const handleSubmit = useCallback(
    (msg: PromptInputMessage) => {
      const text = msg.text?.trim();
      if (!text) return;
      sendMessage({ text }, { body: { sessionId } });
    },
    [sendMessage, sessionId]
  );

  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");

  return (
    <div className="flex flex-col h-full">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent>
          {visible.length === 0 ? (
            <ConversationEmptyState
              title="Начните разговор"
              description="Введите сообщение ниже, чтобы начать чат с агентом"
            />
          ) : (
            visible.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={`${message.id}-${i}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                      const p = part as ToolUIPart;
                      return (
                        <Tool key={`${message.id}-${i}`}>
                          <ToolHeader type={p.type} state={p.state} />
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput onSubmit={handleSubmit} className="mt-3 shrink-0">
        <PromptInputBody>
          <PromptInputTextarea placeholder="Напишите сообщение..." />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit
            status={status === "streaming" || status === "submitted" ? status : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
