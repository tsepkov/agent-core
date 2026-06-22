export interface MemoryAdapter {
  saveToLongTermMemory(key: string, value: unknown): Promise<void>;
  retrieveFromLongTermMemory(key: string): Promise<unknown>;
}

/**
 * Long-term / semantic memory adapter.
 *
 * Operational context (chat history, intermediate state) lives in Restate KV during the active
 * session. Long-term memory is a *separate* concern: durable conclusions, profiles, global rules.
 * Forks implement this interface against their store (PostgreSQL, Vector DB, ...) without mixing
 * database state into the live execution cycle.
 */
export function createMemoryAdapter(overrides: Partial<MemoryAdapter> = {}): MemoryAdapter {
  return {
    async saveToLongTermMemory(_key, _value) {
      // no-op by default
    },
    async retrieveFromLongTermMemory(_key) {
      return null;
    },
    ...overrides,
  };
}
