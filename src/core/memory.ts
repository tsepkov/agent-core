import type { ObjectContext } from "@restatedev/restate-sdk";
import MemoryClient from "mem0ai";

/**
 * Long-term / semantic memory adapter.
 *
 * Operational context (chat history, intermediate state) lives in Restate KV during the active
 * session. Long-term memory is a *separate* concern: durable facts, preferences, and conclusions
 * that persist across sessions.
 *
 * Subclass this to provide a custom memory backend. The default factory (`createMemoryAdapter`)
 * selects a backend by the MEMORY_BACKEND env var.
 *
 * Migration path (hosted → self-hosted):
 *   Current:  MEMORY_BACKEND=mem0-hosted (or auto + MEM0_API_KEY)
 *             → Mem0HostedMemoryAdapter using mem0.ai platform API.
 *   Future:   MEMORY_BACKEND=mem0-oss
 *             → Mem0OssMemoryAdapter using mem0ai/oss with a Qdrant-compatible vector store.
 *             YDB exposes a Qdrant-compatible layer — point the Qdrant driver at YDB to keep
 *             everything in a single database already used by maxbot.
 *   The remember/recall interface does NOT change on migration; only the adapter and config do.
 *   Durability is each adapter's responsibility: wrap side-effecting calls in ctx.run so that
 *   Restate replay does not cause double-writes (see Mem0HostedMemoryAdapter below).
 */
export abstract class MemoryAdapter {
  /** Extract and persist important facts from a completed exchange. */
  abstract remember(
    ctx: ObjectContext,
    userId: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void>;

  /** Retrieve memories relevant to the current user message. Returns plain text snippets. */
  abstract recall(ctx: ObjectContext, userId: string, query: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// No-op implementation (local dev / memory disabled)
// ---------------------------------------------------------------------------

export class NoopMemoryAdapter extends MemoryAdapter {
  async remember(): Promise<void> {}
  async recall(): Promise<string[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mem0 hosted implementation (mem0.ai platform, API key)
// ---------------------------------------------------------------------------

export class Mem0HostedMemoryAdapter extends MemoryAdapter {
  private readonly client: MemoryClient;

  constructor(apiKey?: string) {
    super();
    const key = apiKey ?? process.env.MEM0_API_KEY;
    if (!key) throw new Error("MEM0_API_KEY env var is not set");
    this.client = new MemoryClient({ apiKey: key });
  }

  async remember(
    ctx: ObjectContext,
    userId: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void> {
    await ctx.run("mem0.add", () => this.client.add(messages, { userId }));
  }

  async recall(ctx: ObjectContext, userId: string, query: string): Promise<string[]> {
    const response = await ctx.run("mem0.search", () =>
      this.client.search(query, { filters: { user_id: userId } }),
    );
    return (response.results ?? [])
      .map((r) => (typeof r.memory === "string" ? r.memory : null))
      .filter(Boolean) as string[];
  }
}

// Future: Mem0OssMemoryAdapter
// Uses mem0ai/oss with a Qdrant-compatible vector store (e.g. YDB's Qdrant-compatible layer).
// Activated by MEMORY_BACKEND=mem0-oss. Not implemented until we migrate off the free tier.

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Controls which memory backend createMemoryAdapter() returns. */
export type MemoryBackend =
  | "auto"         // back-compat default: mem0-hosted if MEM0_API_KEY is set, else noop
  | "noop"         // force no-op (useful in tests or when memory is not needed)
  | "mem0-hosted"; // force Mem0HostedMemoryAdapter (requires MEM0_API_KEY)
  // future: | "mem0-oss"  — self-hosted mem0 OSS with Qdrant/YDB vector store

/**
 * Returns a MemoryAdapter instance based on the MEMORY_BACKEND environment variable.
 *
 *   MEMORY_BACKEND=auto (default) — hosted if MEM0_API_KEY present, otherwise noop.
 *   MEMORY_BACKEND=noop          — always noop, even if MEM0_API_KEY is set.
 *   MEMORY_BACKEND=mem0-hosted   — always hosted (throws if MEM0_API_KEY is missing).
 */
export function createMemoryAdapter(): MemoryAdapter {
  const backend = (process.env.MEMORY_BACKEND ?? "auto") as MemoryBackend;
  switch (backend) {
    case "noop":
      return new NoopMemoryAdapter();
    case "mem0-hosted":
      return new Mem0HostedMemoryAdapter();
    // case "mem0-oss":
    //   return new Mem0OssMemoryAdapter();
    case "auto":
    default:
      return process.env.MEM0_API_KEY ? new Mem0HostedMemoryAdapter() : new NoopMemoryAdapter();
  }
}
