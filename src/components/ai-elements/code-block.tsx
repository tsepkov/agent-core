"use client";
import { cn } from "@/lib/utils";
export const CodeBlock = ({ code, language, className }: { code: string; language?: string; className?: string }) => (
  <pre className={cn("p-4 overflow-x-auto font-mono text-xs", className)}>
    <code>{code}</code>
  </pre>
);
