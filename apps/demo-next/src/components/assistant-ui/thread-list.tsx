"use client";

import {
  ThreadListPrimitive,
  ThreadListItemPrimitive,
  useThreadListItemRuntime,
} from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Single thread list item
// ---------------------------------------------------------------------------

function ThreadListItem() {
  const runtime = useThreadListItemRuntime();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const title = runtime.getState().title ?? "";
    setEditTitle(title);
    setIsEditing(true);
  }, [runtime]);

  const commitRename = useCallback(() => {
    if (editTitle.trim()) runtime.rename(editTitle.trim());
    setIsEditing(false);
  }, [editTitle, runtime]);

  return (
    <ThreadListItemPrimitive.Root>
      <ThreadListItemPrimitive.Trigger
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "data-[active]:bg-sidebar-accent data-[active]:text-sidebar-accent-foreground data-[active]:font-medium",
        )}
      >
        {isEditing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setIsEditing(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent border-b border-border outline-none text-sm"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">
            <ThreadListItemPrimitive.Title fallback="Новый чат" />
          </span>
        )}

        {/* Action buttons — visible on hover, hidden while editing */}
        {!isEditing && (
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              onClick={startRename}
              title="Переименовать"
            >
              <Pencil className="size-3" />
            </Button>
            <ThreadListItemPrimitive.Delete asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-5 text-destructive hover:text-destructive"
                title="Удалить"
              >
                <Trash2 className="size-3" />
              </Button>
            </ThreadListItemPrimitive.Delete>
          </span>
        )}
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — thread list with "New chat" button
// ---------------------------------------------------------------------------

export function ThreadList() {
  return (
    <ThreadListPrimitive.Root asChild>
      <aside className="w-64 shrink-0 flex flex-col border-r bg-sidebar text-sidebar-foreground">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Чаты</span>
          <ThreadListPrimitive.New asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="Новый чат"
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </ThreadListPrimitive.New>
        </div>

        {/* Thread list */}
        <ul className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
          <ThreadListPrimitive.Items>
            {() => (
              <li>
                <ThreadListItem />
              </li>
            )}
          </ThreadListPrimitive.Items>
        </ul>
      </aside>
    </ThreadListPrimitive.Root>
  );
}
