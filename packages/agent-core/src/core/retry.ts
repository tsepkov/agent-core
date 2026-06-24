import { APICallError } from "ai";
import type { LanguageModelMiddleware } from "ai";
import { TerminalError, RetryableError } from "@restatedev/restate-sdk";
import type { RunOptions } from "@restatedev/restate-sdk";

/**
 * Parse the `Retry-After` response header (seconds as integer, or HTTP-date) into seconds.
 * Header key matching is case-insensitive.
 * Returns undefined when the header is absent or unparseable.
 */
export function parseRetryAfterSeconds(
  headers: Record<string, string> | undefined
): number | undefined {
  if (!headers) return undefined;
  const raw = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === "retry-after"
  )?.[1];
  if (raw === undefined) return undefined;

  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && asNum >= 0) return asNum;

  // HTTP-date format (e.g. "Wed, 21 Oct 2025 07:28:00 GMT")
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    const seconds = Math.ceil((date - Date.now()) / 1000);
    return seconds > 0 ? seconds : 0;
  }

  return undefined;
}

/**
 * Classify a provider error and rethrow with the appropriate Restate semantics.
 *
 *  - Non-retryable `APICallError` (client 4xx)  → `TerminalError`   — fail-fast, no retry
 *  - Retryable `APICallError` (5xx / 429 / net) → `RetryableError`  — with retryAfter if available
 *  - Any other error                             → rethrow as-is     — Restate retries by default
 *
 * Always throws; return type is `never` so callers in catch blocks are typed correctly.
 * Must be called from inside a `ctx.run` closure where Restate controls the retry loop.
 */
export function classifyProviderError(err: unknown): never {
  if (APICallError.isInstance(err)) {
    if (!err.isRetryable) {
      // Non-retryable 4xx (bad request, unauthorized, forbidden…): fail immediately.
      throw new TerminalError(err.message, { errorCode: err.statusCode });
    }
    // Retryable upstream error (5xx, 429, timeout): honour Retry-After when present.
    const retryAfterSeconds = parseRetryAfterSeconds(
      err.responseHeaders as Record<string, string> | undefined
    );
    if (retryAfterSeconds !== undefined) {
      throw RetryableError.from(err, { retryAfter: { seconds: retryAfterSeconds } });
    }
    // No Retry-After header — let Restate's built-in exponential backoff decide the delay.
    throw RetryableError.from(err);
  }
  // Non-API error (network outage, SDK internal) — rethrow; Restate retries by default.
  throw err as Error;
}

/**
 * Restate `RunOptions` for LLM calls: exponential backoff (1 s → 10 s), no attempt cap,
 * with a 2-minute total-duration limit.
 *
 * The `serde` field is intentionally absent — `durableCalls` injects its own SuperJSON serde.
 * After `maxRetryDuration`, `ctx.run` promotes the error to `TerminalError`; the `chat` handler
 * catches this and writes a graceful error message to the outbox instead of timing out.
 *
 * ---
 * NOTE — Q2: retry progress in the UI
 *   Restate's automatic ctx.run retries are invisible to the UI: the outbox is only written
 *   after a successful generate or on final TerminalError. Two paths to surface per-attempt
 *   status (not implemented; use whichever fits the fork's architecture):
 *
 *   A. Explicit retry loop in the handler:
 *      Replace maxRetryDuration with maxRetryAttempts: 1 (single-shot ctx.run), then catch
 *      RetryableError, write a "retrying… (attempt N, waiting Xs)" entry to the outbox,
 *      call ctx.sleep(backoff), and loop. Each outbox write is visible to the pull bridge.
 *
 *   B. Restate admin/introspection API:
 *      Capture the invocationId from the one-way chat/send response, then poll Restate's
 *      admin API (retry_count, last_failure, next_retry_at) from the bridge route and emit
 *      interim stream chunks to the UI. No agent changes required, but couples the bridge to
 *      Restate's ops surface.
 */
export const LLM_RETRY_OPTIONS = {
  initialRetryInterval: { milliseconds: 1000 },
  retryIntervalFactor: 2,
  maxRetryInterval: { seconds: 10 },
  maxRetryDuration: { minutes: 2 },
} satisfies Omit<RunOptions<unknown>, "serde">;

/**
 * AI SDK middleware that maps `APICallError` HTTP codes to Restate's `TerminalError` /
 * `RetryableError` so the `ctx.run` retry loop handles them correctly.
 *
 * Must be the **innermost** middleware (closest to the provider) when stacked with
 * `durableCalls`, so that converted errors propagate into `ctx.run`.
 *
 * Ordering in `wrapLanguageModel` (first = outermost = owns the retry loop):
 *   middleware: [durableCalls(ctx, LLM_RETRY_OPTIONS), errorClassifierMiddleware]
 */
export const errorClassifierMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  wrapGenerate: async ({ doGenerate }) => {
    try {
      return await doGenerate();
    } catch (err) {
      classifyProviderError(err);
    }
  },
};
