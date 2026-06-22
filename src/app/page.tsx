"use client";

import { useCallback, useState } from "react";
import { Chat } from "@/components/Chat";
import { useSessions } from "@/lib/sessions";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  const { sessions, activeId, create, select, remove, rename } = useSessions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const startRename = useCallback(
    (id: string, currentTitle: string) => {
      setEditingId(id);
      setEditTitle(currentTitle);
    },
    []
  );

  const commitRename = useCallback(
    (id: string) => {
      if (editTitle.trim()) rename(id, editTitle.trim());
      setEditingId(null);
    },
    [editTitle, rename]
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 flex flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Сессии</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => create()}
            title="Новая сессия"
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        </div>

        <ul className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => select(session.id)}
                onKeyDown={(e) => e.key === "Enter" && select(session.id)}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  session.id === activeId &&
                    "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                )}
              >
                {editingId === session.id ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => commitRename(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(session.id);
                      if (e.key === "Escape") setEditingId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-transparent border-b border-border outline-none text-sm"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate">{session.title}</span>
                )}

                {/* Action buttons — visible on hover */}
                {editingId !== session.id && (
                  <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(session.id, session.title);
                      }}
                      title="Переименовать"
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(session.id);
                      }}
                      title="Удалить"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Chat area */}
      <main className="flex-1 min-w-0 flex flex-col p-4 overflow-hidden">
        {activeId ? (
          // key={activeId} forces a full remount when session changes → clean useChat state
          <Chat key={activeId} sessionId={activeId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Создайте сессию, чтобы начать
          </div>
        )}
      </main>
    </div>
  );
}
