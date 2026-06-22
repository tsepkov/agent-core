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
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { readMessages, writeMessages } from "@/lib/sessions";
import type { UIMessage, ToolUIPart } from "ai";

interface ChatProps {
  sessionId: string;
}

// Roles that the Message AI Element understands. Filter out any internal "data" messages.
type RenderableRole = "user" | "assistant" | "system";
const RENDERABLE: Set<string> = new Set<RenderableRole>(["user", "assistant", "system"]);

export function Chat({ sessionId }: ChatProps) {
  const [inputText, setInputText] = useState("");

  // Pre-seed with localStorage mirror so history survives a refresh.
  const [initialMessages] = useState<UIMessage[]>(() => readMessages(sessionId));

  const { messages, sendMessage, status } = useChat({
    id: sessionId,
    messages: initialMessages, // seed from localStorage; only used on first mount
  });

  // Mirror messages to localStorage on every update.
  useEffect(() => {
    writeMessages(sessionId, messages);
  }, [sessionId, messages]);

  const handleSubmit = useCallback(
    (msg: PromptInputMessage) => {
      const text = msg.text?.trim();
      if (!text) return;
      // Pass sessionId so the route bridge can call the correct Restate Virtual Object.
      sendMessage({ text }, { body: { sessionId } });
      setInputText("");
    },
    [sendMessage, sessionId]
  );

  const visible = messages.filter((m) => RENDERABLE.has(m.role));

  return (
    <div className="flex flex-col h-full">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent>
          {visible.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquare className="size-12" />}
              title="Начните разговор"
              description="Введите сообщение ниже, чтобы начать чат с агентом"
            />
          ) : (
            visible.map((message) => (
              <Message from={message.role as RenderableRole} key={message.id}>
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
                          <ToolContent>
                            <ToolInput input={p.input} />
                            <ToolOutput output={p.output} errorText={p.errorText} />
                          </ToolContent>
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
          <PromptInputTextarea
            value={inputText}
            placeholder="Напишите сообщение..."
            onChange={(e) => setInputText(e.target.value)}
          />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit
            status={status === "streaming" || status === "submitted" ? status : "ready"}
            disabled={!inputText.trim() && status === "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
