/**
 * Session management backed by localStorage.
 *
 * Sessions are identified by a locally-generated UUID. The full list and the
 * active session ID are persisted so they survive a page reload.
 * Chat message history (a mirror of the UI state) is stored per-session so
 * useChat can be pre-seeded on revisit.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import type { UIMessage } from "ai";

export interface Session {
  id: string;
  title: string;
  createdAt: number;
}

const SESSIONS_KEY = "agent.sessions";
const ACTIVE_KEY = "agent.activeSession";
const messagesKey = (id: string) => `agent.messages.${id}`;
const durationsKey = (id: string) => `agent.durations.${id}`;

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

export function readMessages(id: string): UIMessage[] {
  try {
    return JSON.parse(
      localStorage.getItem(messagesKey(id)) ?? "[]"
    ) as UIMessage[];
  } catch {
    return [];
  }
}

export function writeMessages(id: string, messages: UIMessage[]) {
  localStorage.setItem(messagesKey(id), JSON.stringify(messages));
}

export function readDurations(id: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(durationsKey(id)) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function writeDurations(id: string, durations: Record<string, number>) {
  localStorage.setItem(durationsKey(id), JSON.stringify(durations));
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

  const remove = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        writeSessions(next);
        // Remove stored messages and durations for the deleted session.
        localStorage.removeItem(messagesKey(id));
        localStorage.removeItem(durationsKey(id));
        return next;
      });
      setActiveId((prev) => {
        if (prev !== id) return prev;
        const remaining = readSessions().filter((s) => s.id !== id);
        const next = remaining[0]?.id ?? null;
        if (next) writeActive(next);
        return next;
      });
    },
    []
  );

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
