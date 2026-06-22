import test from "node:test";
import assert from "node:assert/strict";
import { createAgentHandlers } from "../src/core/agent.js";

/** Minimal in-memory stand-in for the Restate ObjectContext. */
function fakeCtx(overrides = {}) {
  const state = new Map();
  let seq = 0;
  return {
    key: "session-test",
    rand: { uuidv4: () => `uuid-${++seq}` },
    date: { now: () => 1700000000000 },
    runs: [],
    async get(k) {
      return state.has(k) ? state.get(k) : null;
    },
    set(k, v) {
      state.set(k, v);
    },
    clear(k) {
      state.delete(k);
    },
    run(name, fn) {
      this.runs.push(name);
      return fn();
    },
    _state: state,
    ...overrides,
  };
}

const stubGenerate = (text = "hello there", messages) => async (args) => ({
  text: typeof text === "function" ? text(args) : text,
  response: { messages: messages ?? [{ role: "assistant", content: "ok" }] },
});

test("chat returns a messageId, persists history and appends the reply to the outbox", async () => {
  const handlers = createAgentHandlers({ model: {}, generate: stubGenerate("hello there") });

  const ctx = fakeCtx();
  const res = await handlers.chat(ctx, { message: "hi" });

  assert.match(res.messageId, /^uuid-/);
  assert.equal(res.text, undefined, "chat is detached: no synchronous text payload");

  const history = ctx._state.get("history");
  assert.equal(history[0].role, "user");
  assert.equal(history[0].content, "hi");

  const outbox = ctx._state.get("outbox");
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].id, res.messageId);
  assert.equal(outbox[0].role, "assistant");
  assert.equal(outbox[0].content, "hello there");
  assert.equal(outbox[0].ts, 1700000000000);
});

test("chat pushes the reply through the delivery adapter inside a durable ctx.run", async () => {
  const delivered = [];
  const handlers = createAgentHandlers({
    model: {},
    generate: stubGenerate("done"),
    delivery: { deliver: async (_ctx, payload) => delivered.push(payload) },
  });

  const ctx = fakeCtx();
  await handlers.chat(ctx, { message: "go", replyTo: { channel: "web", address: "session-1" } });

  assert.deepEqual(ctx.runs, ["deliver"], "deliver runs as a checkpointed step");
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].target, { channel: "web", address: "session-1" });
  assert.equal(delivered[0].message.content, "done");
});

test("chat accumulates history across turns", async () => {
  const handlers = createAgentHandlers({
    model: {},
    generate: stubGenerate(({ messages }) => `turn-${messages.filter((m) => m.role === "user").length}`),
  });

  const ctx = fakeCtx();
  await handlers.chat(ctx, { message: "first" });
  await handlers.chat(ctx, { message: "second" });

  const userTurns = ctx._state.get("history").filter((m) => m.role === "user");
  assert.equal(userTurns.length, 2);
  assert.equal(ctx._state.get("outbox").length, 2);
});

test("chat binds tools to the context and passes them to generate", async () => {
  let passedTools;
  const echoTool = {
    name: "echo",
    build: (ctx) => ({ description: "echo", ctxKey: ctx.key, execute: async () => "x" }),
  };

  const handlers = createAgentHandlers({
    model: {},
    tools: [echoTool],
    generate: async ({ tools }) => {
      passedTools = tools;
      return { text: "done", response: { messages: [] } };
    },
  });

  await handlers.chat(fakeCtx(), { message: "go" });
  assert.ok(passedTools.echo, "tool should be built and passed under its name");
  assert.equal(passedTools.echo.ctxKey, "session-test", "tool should be bound to the ctx");
});

test("pull returns outbox messages after the cursor and the advanced cursor", async () => {
  const handlers = createAgentHandlers({ model: {}, generate: stubGenerate() });
  const ctx = fakeCtx();
  ctx._state.set("outbox", [{ id: "a" }, { id: "b" }, { id: "c" }]);

  const first = await handlers.pull(ctx, { cursor: 0 });
  assert.deepEqual(first.messages.map((m) => m.id), ["a", "b", "c"]);
  assert.equal(first.cursor, 3);

  const next = await handlers.pull(ctx, { cursor: first.cursor });
  assert.deepEqual(next.messages, []);
  assert.equal(next.cursor, 3);
});

test("pull on an empty session returns no messages at cursor 0", async () => {
  const handlers = createAgentHandlers({ model: {}, generate: stubGenerate() });
  const res = await handlers.pull(fakeCtx(), {});
  assert.deepEqual(res, { messages: [], cursor: 0 });
});

test("reset clears both history and outbox", async () => {
  const handlers = createAgentHandlers({ model: {}, generate: stubGenerate() });
  const ctx = fakeCtx();
  ctx._state.set("history", [{ role: "user", content: "x" }]);
  ctx._state.set("outbox", [{ id: "a" }]);

  const res = await handlers.reset(ctx);

  assert.deepEqual(res, { ok: true });
  assert.equal(ctx._state.has("history"), false);
  assert.equal(ctx._state.has("outbox"), false);
});