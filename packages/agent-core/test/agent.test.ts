import test from "node:test";
import assert from "node:assert/strict";
import { AgentObject } from "../src/index.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";
import type { ModelMessage, ToolSet } from "ai";
import type { AgentTool, AgentObjectConfig, GenerateInput, GenerateOutput } from "../src/index.ts";

type TestAgentConfig = AgentObjectConfig & { generate?: (input: GenerateInput) => Promise<GenerateOutput> };

class TestAgent extends AgentObject {
  readonly name = "test";
  readonly #stub?: (input: GenerateInput) => Promise<GenerateOutput>;
  constructor({ generate, ...rest }: TestAgentConfig) {
    super(rest);
    this.#stub = generate;
  }
  protected override durableGenerate(input: GenerateInput) {
    return this.#stub!(input);
  }
}

/** Minimal in-memory stand-in for the Restate ObjectContext. */
function fakeCtx(overrides: object = {}): ObjectContext {
  const state = new Map<string, unknown>();
  let seq = 0;
  const ctx = {
    key: "session-test",
    rand: { uuidv4: () => `uuid-${++seq}` },
    date: { now: () => 1700000000000 },
    runs: [] as string[],
    get: <T>(k: string) => Promise.resolve((state.has(k) ? state.get(k) : null) as T | null),
    set: (k: string, v: unknown) => { state.set(k, v); },
    clear: (k: string) => { state.delete(k); },
    run: (name: string, fn: () => Promise<unknown>) => {
      ctx.runs.push(name);
      return fn();
    },
    _state: state,
    ...overrides,
  };
  return ctx as unknown as ObjectContext;
}

type StubText = string | ((args: { messages: ModelMessage[] }) => string);

function stubGenerate(text: StubText = "hello there", messages?: ModelMessage[]) {
  return async (args: { messages: ModelMessage[] }): Promise<GenerateOutput> => ({
    text: typeof text === "function" ? text(args) : text,
    response: { messages: messages ?? [{ role: "assistant", content: "ok" }] },
  });
}

test("chat returns a messageId and persists history", async () => {
  const agent = new TestAgent({ model: {} as never, generate: stubGenerate("hello there") });

  const ctx = fakeCtx();
  const res = await agent.chat(ctx, { message: "hi" });

  assert.match(res.messageId, /^uuid-/);
  assert.equal((res as Record<string, unknown>).text, undefined, "chat is detached: no synchronous text payload");

  const state = (ctx as unknown as { _state: Map<string, unknown> })._state;
  const history = state.get("history") as ModelMessage[];
  assert.equal(history[0].role, "user");
  assert.equal(history[0].content, "hi");
});

test("chat pushes the reply through the delivery adapter", async () => {
  const delivered: Array<{ target?: unknown; message: unknown }> = [];
  const agent = new TestAgent({
    model: {} as never,
    generate: stubGenerate("done"),
    delivery: { deliver: async (_ctx: unknown, payload: unknown) => { delivered.push(payload as never); } },
  });

  await agent.chat(fakeCtx(), { message: "go", replyTo: { channel: "web", address: "session-1" } });

  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].target, { channel: "web", address: "session-1" });
  assert.equal((delivered[0].message as { content: string }).content, "done");
});

test("chat accumulates history across turns", async () => {
  const agent = new TestAgent({
    model: {} as never,
    generate: stubGenerate(({ messages }) => `turn-${messages.filter((m) => m.role === "user").length}`),
  });

  const ctx = fakeCtx();
  await agent.chat(ctx, { message: "first" });
  await agent.chat(ctx, { message: "second" });

  const state = (ctx as unknown as { _state: Map<string, unknown> })._state;
  const userTurns = (state.get("history") as ModelMessage[]).filter((m) => m.role === "user");
  assert.equal(userTurns.length, 2);
});

test("chat binds tools to the context and passes them to generate", async () => {
  let passedTools: ToolSet | undefined;

  const echoTool = {
    name: "echo",
    build: (ctx: ObjectContext) => ({ description: "echo", ctxKey: ctx.key, execute: async () => "x" }),
  } as unknown as AgentTool;

  const agent = new TestAgent({
    model: {} as never,
    tools: [echoTool],
    generate: async ({ tools }: GenerateInput): Promise<GenerateOutput> => {
      passedTools = tools;
      return { text: "done", response: { messages: [] } };
    },
  });

  await agent.chat(fakeCtx(), { message: "go" });
  assert.ok(passedTools!.echo, "tool should be built and passed under its name");
  assert.equal(
    (passedTools!.echo as unknown as { ctxKey: string }).ctxKey,
    "session-test",
    "tool should be bound to the ctx"
  );
});

test("reset clears history", async () => {
  const agent = new TestAgent({ model: {} as never, generate: stubGenerate() });
  const ctx = fakeCtx();
  const state = (ctx as unknown as { _state: Map<string, unknown> })._state;
  state.set("history", [{ role: "user", content: "x" }]);

  const res = await agent.reset(ctx);

  assert.deepEqual(res, { ok: true });
  assert.equal(state.has("history"), false);
});
