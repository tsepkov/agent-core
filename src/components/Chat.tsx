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
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { readMessages, writeMessages } from "@/lib/sessions";
import type { UIMessage, DynamicToolUIPart } from "ai";

export function Chat({ sessionId }: { sessionId: string }) {
  const [initialMessages] = useState<UIMessage[]>(() => readMessages(sessionId));
  // duration in seconds, keyed by assistant message id
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [elapsedS, setElapsedS] = useState(0);
  const sendTimeRef = useRef<number | null>(null);

  const { messages, sendMessage, status } = useChat({
    id: sessionId,
    messages: initialMessages,
  });

  useEffect(() => {
    writeMessages(sessionId, messages);
  }, [sessionId, messages]);

  const isActive = status === "submitted" || status === "streaming";

  // live counter while waiting
  useEffect(() => {
    if (!isActive || sendTimeRef.current === null) return;
    setElapsedS(0);
    const id = setInterval(() => {
      setElapsedS(Math.floor((Date.now() - sendTimeRef.current!) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [isActive]);

  useEffect(() => {
    if (status === "ready" && sendTimeRef.current != null) {
      const durationS = Math.ceil((Date.now() - sendTimeRef.current) / 1000);
      sendTimeRef.current = null;
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) {
        setDurations((prev) => ({ ...prev, [lastAssistant.id]: durationS }));
      }
    }
  }, [status, messages]);

  const handleSubmit = useCallback(
    (msg: PromptInputMessage) => {
      const text = msg.text?.trim();
      if (!text) return;
      sendTimeRef.current = Date.now();
      sendMessage({ text }, { body: { sessionId } });
    },
    [sendMessage, sessionId]
  );

  const thinkingMessage = useCallback(
    (_isStreaming: boolean, duration?: number): ReactNode => {
      if (duration !== undefined) return <p>Thought for {duration} seconds</p>;
      return <p>Thinking... {elapsedS > 0 ? `${elapsedS}s` : ""}</p>;
    },
    [elapsedS]
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
                  {message.role === "assistant" && (() => {
                    const isLast = message.id === visible[visible.length - 1]?.id;
                    const isStreaming = isLast && isActive;
                    const reasoningPart = message.parts.find((p) => p.type === "reasoning");
                    return (
                      <Reasoning
                        key={`${message.id}-reasoning`}
                        defaultOpen={false}
                        isStreaming={isStreaming}
                        duration={isStreaming ? undefined : durations[message.id]}
                      >
                        <ReasoningTrigger getThinkingMessage={thinkingMessage} />
                        {reasoningPart && (
                          <ReasoningContent>{(reasoningPart as { text: string }).text}</ReasoningContent>
                        )}
                      </Reasoning>
                    );
                  })()}
                  {message.parts.map((part, i) => {
                    if (part.type === "reasoning") return null;
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={`${message.id}-${i}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                      const p = part as DynamicToolUIPart;
                      const hasOutput = p.state === "output-available" || p.state === "output-error";
                      return (
                        <Tool key={`${message.id}-${i}`} defaultOpen={!hasOutput}>
                          <ToolHeader type={p.type} state={p.state} toolName={p.toolName} />
                          <ToolContent>
                            <ToolInput input={p.input} />
                            {hasOutput && (
                              <ToolOutput
                                output={p.state === "output-available" ? p.output : undefined}
                                errorText={p.state === "output-error" ? p.errorText : undefined}
                              />
                            )}
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
        {isActive && visible[visible.length - 1]?.role === "user" && (
          <Reasoning defaultOpen={false} isStreaming={true} className="px-4">
            <ReasoningTrigger getThinkingMessage={thinkingMessage} />
          </Reasoning>
        )}
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
