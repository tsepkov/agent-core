import test from "node:test";
import assert from "node:assert/strict";
import { APICallError } from "ai";
import { TerminalError, RetryableError } from "@restatedev/restate-sdk";
import { classifyProviderError, parseRetryAfterSeconds, AgentObject } from "../src/core/index.ts";
import type { ObjectContext, ObjectSharedContext } from "@restatedev/restate-sdk";

// ---------------------------------------------------------------------------
// parseRetryAfterSeconds
// ---------------------------------------------------------------------------

test("parseRetryAfterSeconds: numeric seconds string", () => {
  assert.equal(parseRetryAfterSeconds({ "retry-after": "30" }), 30);
});

test("parseRetryAfterSeconds: zero seconds", () => {
  assert.equal(parseRetryAfterSeconds({ "retry-after": "0" }), 0);
});

test("parseRetryAfterSeconds: case-insensitive header key", () => {
  assert.equal(parseRetryAfterSeconds({ "Retry-After": "5" }), 5);
});

test("parseRetryAfterSeconds: undefined headers returns undefined", () => {
  assert.equal(parseRetryAfterSeconds(undefined), undefined);
});

test("parseRetryAfterSeconds: missing header returns undefined", () => {
  assert.equal(parseRetryAfterSeconds({}), undefined);
});

// ---------------------------------------------------------------------------
// classifyProviderError: non-retryable 4xx → TerminalError
// ---------------------------------------------------------------------------

test("classifyProviderError: 400 bad request → TerminalError", () => {
  const err = new APICallError({
    message: "bad request",
    url: "https://openrouter.ai",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: "",
  });
  assert.throws(
    () => classifyProviderError(err),
    (e: unknown) => e instanceof TerminalError
  );
});

test("classifyProviderError: 401 unauthorized → TerminalError", () => {
  const err = new APICallError({
    message: "unauthorized",
    url: "https://openrouter.ai",
    requestBodyValues: {},
    statusCode: 401,
    responseBody: "",
  });
  assert.throws(
    () => classifyProviderError(err),
    (e: unknown) => e instanceof TerminalError
  );
});

test("classifyProviderError: 403 forbidden → TerminalError", () => {
  const err = new APICallError({
    message: "forbidden",
    url: "https://openrouter.ai",
    requestBodyValues: {},
    statusCode: 403,
    responseBody: "",
  });
  assert.throws(
    () => classifyProviderError(err),
    (e: unknown) => e instanceof TerminalError
  );
});

// ---------------------------------------------------------------------------
// classifyProviderError: retryable 5xx / 429 → RetryableError
// ---------------------------------------------------------------------------

test("classifyProviderError: 500 without Retry-After → RetryableError (no retryAfter)", () => {
  const err = new APICallError({
    message: "[500] rate-limited upstream. Please retry shortly.",
    url: "https://openrouter.ai",
    requestBodyValues: {},
    statusCode: 500,
    responseBody: "",
  });
  assert.throws(
    () => classifyProviderError(err),
    (e: unknown) => {
      assert.ok(e instanceof RetryableError);
      assert.equal((e as RetryableError).retryAfter, undefined);
      return true;
    }
  );
});

test("classifyProviderError: 429 with Retry-After header → RetryableError with retryAfter", () => {
  const err = new APICallError({
    message: "too many requests",
    url: "https://openrouter.ai",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { "retry-after": "10" },
    responseBody: "",
  });
  assert.throws(
    () => classifyProviderError(err),
    (e: unknown) => {
      assert.ok(e instanceof RetryableError);
      assert.deepEqual((e as RetryableError).retryAfter, { seconds: 10 });
      return true;
    }
  );
});

test("classifyProviderError: 503 service unavailable → RetryableError", () => {
  const err = new APICallError({
    message: "service unavailable",
    url: "https://openrouter.ai",
    requestBodyValues: {},
    statusCode: 503,
    responseBody: "",
  });
  assert.throws(
    () => classifyProviderError(err),
    (e: unknown) => e instanceof RetryableError
  );
});

// ---------------------------------------------------------------------------
// classifyProviderError: non-APICallError → rethrown as-is
// ---------------------------------------------------------------------------

test("classifyProviderError: generic Error rethrown as-is", () => {
  const original = new Error("network timeout");
  assert.throws(
    () => classifyProviderError(original),
    (e: unknown) => e === original
  );
});

test("classifyProviderError: string error rethrown as-is", () => {
  assert.throws(
    () => classifyProviderError("unexpected string error"),
    (e: unknown) => e === "unexpected string error"
  );
});

// ---------------------------------------------------------------------------
// chat handler: TerminalError from generate → graceful outbox error message
// ---------------------------------------------------------------------------

function fakeCtx(overrides: object = {}): ObjectContext {
  const state = new Map<string, unknown>();
  let seq = 0;
  const ctx = {
    key: "session-test",
    rand: { uuidv4: () => `uuid-${++seq}` },
    date: { now: () => Promise.resolve(1700000000000) },
    runs: [] as string[],
    get: <T>(k: string) => Promise.resolve((state.has(k) ? state.get(k) : null) as T | null),
    set: (k: string, v: unknown) => { state.set(k, v); },
    clear: (k: string) => { state.delete(k); },
    run: (_name: string, fn: () => Promise<unknown>) => fn(),
    _state: state,
    ...overrides,
  };
  return ctx as unknown as ObjectContext;
}

test("chat: TerminalError from generate → returns messageId without throw", async () => {
  const agent = new AgentObject({
    model: {} as never,
    generate: async () => { throw new TerminalError("upstream error", { errorCode: 500 }); },
  });

  const res = await agent.chat(fakeCtx(), { message: "hello" });

  assert.match(res.messageId, /^uuid-/);
});

test("chat: TerminalError from generate → history not persisted (user can retry cleanly)", async () => {
  const agent = new AgentObject({
    model: {} as never,
    generate: async () => { throw new TerminalError("upstream error"); },
  });

  // Start with no history so the fakeCtx.get returns null (not a mutable reference).
  // In real Restate, ctx.get always deserializes a fresh copy, so in-memory mutations never
  // escape without an explicit ctx.set. Here we verify ctx.set("history", ...) was never called.
  const ctx = fakeCtx();
  await agent.chat(ctx, { message: "hello" });

  const state = (ctx as unknown as { _state: Map<string, unknown> })._state;
  assert.ok(!state.has("history"), "ctx.set('history', ...) must not be called on terminal error");
});

test("chat: non-TerminalError from generate is rethrown", async () => {
  const agent = new AgentObject({
    model: {} as never,
    generate: async () => { throw new Error("unexpected crash"); },
  });

  await assert.rejects(
    () => agent.chat(fakeCtx(), { message: "hello" }),
    (e: unknown) => e instanceof Error && (e as Error).message === "unexpected crash"
  );
});

test("chat: TerminalError from generate → delivery adapter receives error message", async () => {
  const delivered: Array<{ message: { content: string } }> = [];
  const agent = new AgentObject({
    model: {} as never,
    generate: async () => { throw new TerminalError("upstream error"); },
    delivery: {
      deliver: async (_ctx, payload) => {
        delivered.push(payload as { message: { content: string } });
      },
    },
  });

  await agent.chat(fakeCtx(), { message: "hi", replyTo: { channel: "web", address: "s1" } });

  assert.equal(delivered.length, 1);
  assert.ok(
    delivered[0].message.content.includes("unavailable"),
    "delivery adapter should receive the error message"
  );
});
