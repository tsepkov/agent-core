"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, Loader2Icon, WrenchIcon } from "lucide-react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// ToolGroup — collapses a run of consecutive tool calls into one card
// ---------------------------------------------------------------------------

export function ToolGroupRoot({ children }: { children: ReactNode }) {
  return (
    <Collapsible defaultOpen={false} className="my-1">
      {children}
    </Collapsible>
  );
}

export function ToolGroupTrigger({
  count,
  active,
}: {
  count: number;
  active: boolean;
}) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 rounded-md border bg-muted/50 px-3 py-2",
        "text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
      )}
    >
      <WrenchIcon className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">
        {count} tool call{count !== 1 ? "s" : ""}
      </span>
      {active && <Loader2Icon className="size-3.5 shrink-0 animate-spin" />}
      <ChevronDownIcon className="size-3.5 shrink-0 transition-transform data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
}

export function ToolGroupContent({ children }: { children: ReactNode }) {
  return (
    <CollapsibleContent className="mt-1 space-y-1">{children}</CollapsibleContent>
  );
}
