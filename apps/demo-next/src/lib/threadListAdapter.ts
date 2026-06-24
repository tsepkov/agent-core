"use client";

/**
 * Thread list + per-thread history adapter backed by localStorage.
 *
 * Uses the built-in assistant-ui createLocalStorageAdapter which handles:
 *   - Thread metadata (list, create, rename, archive, delete)
 *   - Per-thread message history (load on switch, append on each message)
 *
 * The adapter is a RemoteThreadListAdapter — the same interface maxbot will
 * later replace with an API/Turso-backed implementation, keeping the UI
 * layer unchanged.
 *
 * createSimpleTitleAdapter auto-titles threads from the first user message
 * (truncated to 50 chars), so no manual "Новая сессия" / rename plumbing needed.
 */

import { createLocalStorageAdapter, createSimpleTitleAdapter } from "@assistant-ui/core/react";

const asyncStorage = {
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) => { localStorage.setItem(key, value); },
  removeItem: async (key: string) => { localStorage.removeItem(key); },
};

export function createThreadListAdapter() {
  return createLocalStorageAdapter({
    storage: asyncStorage,
    prefix: "agent.aui:",
    titleGenerator: createSimpleTitleAdapter(),
  });
}
