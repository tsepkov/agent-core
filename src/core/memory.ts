import type { ObjectContext } from "@restatedev/restate-sdk";
import MemoryClient from "mem0ai";

/**
 * Long-term / semantic memory adapter.
 *
 * Operational context (chat history, intermediate state) lives in Restate KV during the active
 * session. Long-term memory is a *separate* concern: durable facts, preferences, and conclusions
 * that persist across sessions.
 *
 * Subclass this to provide a custom memory backend. The default factory returns
 * `Mem0MemoryAdapter` when MEM0_API_KEY is set, otherwise `NoopMemoryAdapter`.
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
// Mem0 hosted implementation
// ---------------------------------------------------------------------------

export class Mem0MemoryAdapter extends MemoryAdapter {
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a MemoryAdapter instance.
 * - If MEM0_API_KEY is set: returns Mem0MemoryAdapter.
 * - Otherwise: returns NoopMemoryAdapter (safe for local dev without a key).
 */
export function createMemoryAdapter(): MemoryAdapter {
  return process.env.MEM0_API_KEY ? new Mem0MemoryAdapter() : new NoopMemoryAdapter();
}
