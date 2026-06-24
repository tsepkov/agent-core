"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { useRestateRuntime } from "@/hooks/useRestateRuntime";
import { createThreadListAdapter } from "@/lib/threadListAdapter";

// ---------------------------------------------------------------------------
// Chat — wires RemoteThreadListRuntime (localStorage adapter + Restate pubsub)
// and renders the sidebar + thread panel.
//
// Thread persistence (history) is handled by the createLocalStorageAdapter
// injected into useRemoteThreadListRuntime via its unstable_Provider —
// no manual SessionPersist / writeMessages needed.
//
// In maxbot, swap createThreadListAdapter() for a Turso/API-backed adapter;
// useRestateRuntime stays as-is.
// ---------------------------------------------------------------------------

export function Chat() {
  // Stable adapter instance — recreated only on remount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adapter = useMemo(() => createThreadListAdapter(), []);

  const runtime = useRemoteThreadListRuntime({
    // runtimeHook is called per-thread inside RemoteThreadListRuntime.
    // It reads its sessionId from useThreadListItemRuntime().initialize().
    runtimeHook: useRestateRuntime,
    adapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-screen overflow-hidden">
        <ThreadList />
        <main className="flex-1 min-w-0 flex flex-col p-4 overflow-hidden">
          <Thread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}
