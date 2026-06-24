"use client";

/**
 * User identity — a stable random UUID stored in localStorage.
 * Used to scope long-term memory in Mem0 across multiple chat sessions.
 *
 * Thread list and per-thread message history are now managed by the
 * assistant-ui RemoteThreadListRuntime (see src/lib/threadListAdapter.ts).
 */

const USER_ID_KEY = "agent.userId";

export function getOrCreateUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}
