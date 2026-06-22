import test from "node:test";
import assert from "node:assert/strict";
import { createAgentHandlers } from "../src/core/agent.js";

/** Minimal in-memory stand-in for the Restate ObjectContext. */
function fakeCtx() {
  const state = new Map();
  return {
    key: "session-test",
    rand: { uuidv4: () => "fixed-uuid" },
    async get(k) {
      return state.has(k) ? state.get(k) : null;
    },
    set(k, v) {
      state.set(k, v);
    },
    clear(k) {
      state.delete(k);
    },
    run(_name, fn) {
      return fn();
    },
    _state: state,
  };
}

test("chat returns model text and persists history to KV", async () => {
  const handlers = createAgentHandlers({
    model: {},
    generate: async () => ({
      text: "hello there",
      response: { messages: [{ role: "assistant", content: "hello there" }] },
    }),
  });

  const ctx = fakeCtx();
  const res = await handlers.chat(ctx, { message: "hi" });

  assert.equal(res.text, "hello there");
  const history = ctx._state.get("history");
  assert.equal(history[0].role, "user");
  assert.equal(history[0].content, "hi");
  assert.equal(history.at(-1).role, "assistant");
});

test("chat accumulates history across turns", async () => {
  const handlers = createAgentHandlers({
    model: {},
    generate: async ({ messages }) => ({
      text: `turn-${messages.filter((m) => m.role === "user").length}`,
      response: { messages: [{ role: "assistant", content: "ok" }] },
    }),
  });

  const ctx = fakeCtx();
  await handlers.chat(ctx, { message: "first" });
  const res = await handlers.chat(ctx, { message: "second" });

  assert.equal(res.text, "turn-2");
  const userTurns = ctx._state.get("history").filter((m) => m.role === "user");
  assert.equal(userTurns.length, 2);
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

test("reset clears the session history", async () => {
  const handlers = createAgentHandlers({ model: {}, generate: async () => ({}) });
  const ctx = fakeCtx();
  ctx._state.set("history", [{ role: "user", content: "x" }]);

  const res = await handlers.reset(ctx);

  assert.deepEqual(res, { ok: true });
  assert.equal(ctx._state.has("history"), false);
});
