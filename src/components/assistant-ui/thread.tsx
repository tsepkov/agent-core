"use client";

import {
  AuiIf,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  AttachmentPrimitive,
  useAuiState,
  useAttachment,
  useMessageTiming,
} from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import {
  ArrowDownIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  PaperclipIcon,
  RotateCcwIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const streamdownPlugins = { cjk, code, math, mermaid };

// ---------------------------------------------------------------------------
// Attachment preview — works for both composer (file) and message (data URL)
// ---------------------------------------------------------------------------

function AttachmentPreview() {
  const state = useAttachment();
  const objectUrlRef = useRef<string | null>(null);

  const imageSrc = useMemo(() => {
    if (state.type !== "image") return undefined;
    // Pending (file in hand) — build an object URL.
    if (state.source !== "message" && state.file) {
      const url = URL.createObjectURL(state.file);
      objectUrlRef.current = url;
      return url;
    }
    // Complete attachment stored in content.
    const imgPart = state.content?.find((p) => p.type === "image");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return imgPart ? (imgPart as any).image as string : undefined;
  }, [state]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  if (state.type === "image" && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={state.name}
        className="size-14 rounded-md object-cover"
      />
    );
  }

  // Document / file — show icon chip with name.
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground max-w-[140px]">
      <FileIcon className="size-4 shrink-0" />
      <span className="truncate">{state.name}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking/Thought indicator — timer + optional reasoning text collapsible
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reasoningText = useAuiState((s) => (s.message.content as any[])?.find((p) => p.type === "reasoning")?.text as string | undefined);
  const timing = useMessageTiming();
  const finalSeconds = timing?.totalStreamTime !== undefined
    ? Math.round(timing.totalStreamTime / 1000)
    : 0;

  // Live elapsed counter while running.
  const startRef = useRef<number | null>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);

  useEffect(() => {
    if (isRunning) {
      if (startRef.current === null) startRef.current = Date.now();
      setLiveSeconds(Math.round((Date.now() - startRef.current) / 1000));
      const id = setInterval(() => {
        setLiveSeconds(Math.round((Date.now() - startRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      // Reset for future re-runs (e.g. Reload button).
      startRef.current = null;
      setLiveSeconds(0);
    }
  }, [isRunning]);

  // Hide for old completed messages with no useful data.
  if (!isRunning && finalSeconds === 0 && !reasoningText) return null;

  const label = isRunning
    ? `Thinking… ${liveSeconds}s`
    : `Thought for ${finalSeconds} second${finalSeconds !== 1 ? "s" : ""}`;

  if (!reasoningText) {
    // Plain status line — no expand toggle.
    return (
      <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
        <BrainIcon className="size-4 shrink-0" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={false} className="mb-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <BrainIcon className="size-4 shrink-0" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDownIcon className="size-4 transition-transform data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 text-sm text-muted-foreground border-l-2 pl-3">
        <Streamdown plugins={streamdownPlugins}>{reasoningText}</Streamdown>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Default tool-call part — collapsible, shows input/output
// ---------------------------------------------------------------------------

type ToolCallPart = {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  toolUI?: ReactNode;
};

function DefaultToolCall({ toolName, args, result, isError }: ToolCallPart) {
  const hasOutput = result !== undefined;
  return (
    <Collapsible defaultOpen={!hasOutput} className="my-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
        <span className="font-mono truncate flex-1 text-left">{toolName}</span>
        <span
          className={cn(
            "text-xs font-medium shrink-0",
            hasOutput
              ? isError
                ? "text-destructive"
                : "text-green-600 dark:text-green-500"
              : "text-yellow-600 dark:text-yellow-500",
          )}
        >
          {hasOutput ? (isError ? "error" : "done") : "running…"}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 transition-transform data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-md border bg-muted/30 p-3 text-xs font-mono space-y-2 overflow-x-auto">
          <div>
            <p className="text-muted-foreground mb-1">Input</p>
            <pre className="whitespace-pre-wrap">{JSON.stringify(args, null, 2)}</pre>
          </div>
          {hasOutput && (
            <div>
              <p className={cn("mb-1", isError ? "text-destructive" : "text-muted-foreground")}>
                {isError ? "Error" : "Output"}
              </p>
              <pre className="whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// User message
// ---------------------------------------------------------------------------

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end w-full mb-6">
      <div className="max-w-[80%] flex flex-col items-end gap-2">
        {/* Attached images above the text bubble */}
        <MessagePrimitive.Attachments>
          {() => (
            <AttachmentPrimitive.Root className="relative">
              <AttachmentPreview />
            </AttachmentPrimitive.Root>
          )}
        </MessagePrimitive.Attachments>

        <div className="rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") {
                return <p className="whitespace-pre-wrap">{part.text}</p>;
              }
              return null;
            }}
          </MessagePrimitive.Parts>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Assistant message
// ---------------------------------------------------------------------------

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group flex flex-col w-full mb-6">
      <div className="max-w-[95%] flex flex-col gap-1 text-sm">
        {/* Thinking/Thought timer — always rendered so non-thinking models show feedback */}
        <ThinkingIndicator />

        <MessagePrimitive.Parts>
          {({ part }) => {
            switch (part.type) {
              case "reasoning":
                // Handled by ThinkingIndicator above.
                return null;

              case "tool-call": {
                const p = part as unknown as ToolCallPart;
                return p.toolUI ? <>{p.toolUI}</> : <DefaultToolCall {...p} />;
              }

              case "text":
                return <Streamdown plugins={streamdownPlugins}>{part.text}</Streamdown>;

              default:
                return null;
            }
          }}
        </MessagePrimitive.Parts>

        <MessagePrimitive.Error>
          <p className="text-sm text-destructive">Ошибка при генерации ответа.</p>
        </MessagePrimitive.Error>
      </div>

      {/* Action bar — shown on hover */}
      <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <ActionBarPrimitive.Copy asChild>
          <Button variant="ghost" size="icon" className="size-7" title="Копировать">
            <CopyIcon className="size-3.5" />
          </Button>
        </ActionBarPrimitive.Copy>

        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon" className="size-7" title="Сгенерировать снова">
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </ActionBarPrimitive.Reload>

        <AuiIf condition={({ message }) => message.branchCount > 1}>
          <BranchPickerPrimitive.Root className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <BranchPickerPrimitive.Previous asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <ChevronLeftIcon className="size-3.5" />
              </Button>
            </BranchPickerPrimitive.Previous>
            <span>
              <BranchPickerPrimitive.Number />
              {"/"}
              <BranchPickerPrimitive.Count />
            </span>
            <BranchPickerPrimitive.Next asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </BranchPickerPrimitive.Next>
          </BranchPickerPrimitive.Root>
        </AuiIf>
      </div>
    </MessagePrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer() {
  return (
    <div className="flex flex-col gap-2">
      {/* Pending attachment thumbnails */}
      <ComposerPrimitive.Attachments>
        {() => (
          <AttachmentPrimitive.Root className="relative inline-flex">
            <AttachmentPreview />
            <AttachmentPrimitive.Remove asChild>
              <button
                className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs leading-none"
                title="Удалить"
              >
                ×
              </button>
            </AttachmentPrimitive.Remove>
          </AttachmentPrimitive.Root>
        )}
      </ComposerPrimitive.Attachments>

      <ComposerPrimitive.Root className="relative flex items-end gap-2 rounded-xl border bg-background px-4 py-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <ComposerPrimitive.Input
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground max-h-40"
          placeholder="Напишите сообщение…"
          rows={1}
          autoFocus
        />

        {/* Attach image button */}
        <ComposerPrimitive.AddAttachment asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" title="Прикрепить изображение">
            <PaperclipIcon className="size-4" />
          </Button>
        </ComposerPrimitive.AddAttachment>

        {/* Send / Cancel toggle */}
        <AuiIf condition={({ thread }) => thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" title="Остановить">
              <SquareIcon className="size-4" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>

        <AuiIf condition={({ thread }) => !thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 disabled:opacity-40"
              title="Отправить"
            >
              <SendIcon className="size-4" />
            </Button>
          </ComposerPrimitive.Send>
        </AuiIf>
      </ComposerPrimitive.Root>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Thread export
// ---------------------------------------------------------------------------

export function Thread() {
  return (
    <ThreadPrimitive.Root className="relative flex flex-col h-full">
      {/* Empty state */}
      <AuiIf condition={({ thread }) => thread.isEmpty}>
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 p-8 text-center text-muted-foreground">
          <p className="text-sm font-medium">Начните разговор</p>
          <p className="text-xs">Введите сообщение ниже, чтобы начать чат с агентом</p>
        </div>
      </AuiIf>

      {/* Message list */}
      <AuiIf condition={({ thread }) => !thread.isEmpty}>
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            <ThreadPrimitive.Messages>
              {({ message }) =>
                message.role === "user" ? <UserMessage /> : <AssistantMessage />
              }
            </ThreadPrimitive.Messages>
          </div>
        </ThreadPrimitive.Viewport>
      </AuiIf>

      {/* Scroll-to-bottom button */}
      <ThreadPrimitive.ScrollToBottom className="absolute bottom-20 left-1/2 -translate-x-1/2 flex size-8 items-center justify-center rounded-full border bg-background shadow-md hover:bg-muted transition-colors">
        <ArrowDownIcon className="size-4" />
      </ThreadPrimitive.ScrollToBottom>

      {/* Composer */}
      <div className="px-4 pb-4 pt-2 shrink-0">
        <Composer />
      </div>
    </ThreadPrimitive.Root>
  );
}
