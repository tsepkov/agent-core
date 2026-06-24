"use client";

import { useEffect, useState } from "react";
import { AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useRestateRuntime } from "@/hooks/useRestateRuntime";
import { readMessages, writeMessages } from "@/lib/sessions";

// ---------------------------------------------------------------------------
// Session persistence — syncs assistant-ui thread state to localStorage.
// Must live inside AssistantRuntimeProvider to access runtime context.
// ---------------------------------------------------------------------------

function SessionPersist({ sessionId }: { sessionId: string }) {
  const messages = useAuiState((s) => s.thread.messages);
  useEffect(() => {
    // MessageState[] satisfies ThreadMessageLike[] for serialisation purposes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writeMessages(sessionId, messages as any);
  }, [sessionId, messages]);
  return null;
}

// ---------------------------------------------------------------------------
// Chat — wires LocalRuntime (Restate pubsub transport) and renders the thread.
// ---------------------------------------------------------------------------

export function Chat({ sessionId }: { sessionId: string }) {
  // Load persisted messages once on mount; don't re-derive on subsequent renders.
  const [initialMessages] = useState<ThreadMessageLike[]>(() => readMessages(sessionId));
  const runtime = useRestateRuntime({ sessionId, initialMessages });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SessionPersist sessionId={sessionId} />
      <Thread />
    </AssistantRuntimeProvider>
  );
}
