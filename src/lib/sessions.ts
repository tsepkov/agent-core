/**
 * Session management backed by localStorage.
 *
 * Sessions are identified by a locally-generated UUID. The full list and the
 * active session ID are persisted so they survive a page reload.
 * Chat message history (a mirror of assistant-ui thread state) is stored
 * per-session so useRestateRuntime can be pre-seeded with initialMessages.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";

export interface Session {
  id: string;
  title: string;
  createdAt: number;
}

const SESSIONS_KEY = "agent.sessions";
const ACTIVE_KEY = "agent.activeSession";
const USER_ID_KEY = "agent.userId";
const messagesKey = (id: string) => `agent.messages.${id}`;

/**
 * Returns a stable, cross-session user ID stored in localStorage.
 * Used to scope long-term memory in Mem0 across multiple chat sessions.
 */
export function getOrCreateUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

function readSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]") as Session[];
  } catch {
    return [];
  }
}

function writeSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function readActive(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

function writeActive(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

/**
 * Load persisted messages for a session as ThreadMessageLike.
 * Date objects are revived from ISO strings (JSON.stringify serialises Date → string).
 */
export function readMessages(id: string): ThreadMessageLike[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = JSON.parse(localStorage.getItem(messagesKey(id)) ?? "[]") as any[];
    if (!Array.isArray(raw)) return [];
    return raw
      // Skip messages in old UIMessage format (parts[] instead of content[]).
      .filter((m) => m?.role && Array.isArray(m?.content))
      .map((m) => ({
        ...m,
        createdAt: m.createdAt ? new Date(m.createdAt as string) : new Date(),
      }));
  } catch {
    return [];
  }
}

/** Persist assistant-ui thread messages for a session. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeMessages(id: string, messages: any[]) {
  localStorage.setItem(messagesKey(id), JSON.stringify(messages));
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Hydrate from localStorage once on mount (avoids SSR mismatch).
  useEffect(() => {
    const stored = readSessions();
    if (stored.length === 0) {
      // Bootstrap with one session so the user lands in an active chat.
      const first = makeSession();
      writeSessions([first]);
      writeActive(first.id);
      setSessions([first]);
      setActiveId(first.id);
    } else {
      setSessions(stored);
      const active = readActive();
      setActiveId(active && stored.some((s) => s.id === active) ? active : stored[0].id);
    }
  }, []);

  const create = useCallback(() => {
    const s = makeSession();
    setSessions((prev) => {
      const next = [s, ...prev];
      writeSessions(next);
      return next;
    });
    writeActive(s.id);
    setActiveId(s.id);
    return s;
  }, []);

  const select = useCallback((id: string) => {
    writeActive(id);
    setActiveId(id);
  }, []);

  const remove = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      writeSessions(next);
      localStorage.removeItem(messagesKey(id));
      return next;
    });
    setActiveId((prev) => {
      if (prev !== id) return prev;
      const remaining = readSessions().filter((s) => s.id !== id);
      const next = remaining[0]?.id ?? null;
      if (next) writeActive(next);
      return next;
    });
  }, []);

  const rename = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, title } : s));
      writeSessions(next);
      return next;
    });
  }, []);

  return { sessions, activeId, create, select, remove, rename };
}

function makeSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "Новая сессия",
    createdAt: Date.now(),
  };
}
