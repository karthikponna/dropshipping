import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test of the error mapping. It builds real `@anthropic-ai/sdk` error
 * objects (no network — `APIError.generate` just picks the subclass for a status)
 * and asserts each one lands on the right `GenerationErrorCode`, HTTP status and
 * retryability.
 *
 * Run it with:
 *   node lib/ai/errors.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } = await import(
  "@anthropic-ai/sdk"
);
const { toGenerationError } = await import("./client.ts");
const { GenerationError } = await import("@/lib/types");
const {
  FALLBACK_MODEL_CHOICES,
  GENERATION_MODEL,
  isModelId,
  isSelectableModel,
  supportsEffort,
} = await import("./model.ts");

let checks = 0;
let failures = 0;

function check(label, fn) {
  checks += 1;
  try {
    fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL ${label}\n       ${error.message.slice(0, 400)}\n`);
  }
}

function apiError(status, type, message) {
  return APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());
}

function expect(label, thrown, { code, retryable, status }) {
  check(label, () => {
    const mapped = toGenerationError(thrown);
    assert.ok(mapped instanceof GenerationError, "must map to a GenerationError");
    assert.equal(mapped.code, code, `code: got ${mapped.code}`);
    assert.equal(mapped.retryable, retryable, `retryable: got ${mapped.retryable}`);
    if (status !== undefined) assert.equal(mapped.status, status, `status: got ${mapped.status}`);
    assert.ok(mapped.message.length > 0, "an error must carry a message for the chat rail");
    const event = mapped.toEvent();
    assert.equal(event.type, "error");
    assert.equal(event.code, code);
    assert.equal(event.retryable, retryable);
  });
}

process.stdout.write("\nAnthropic error mapping\n");

expect("401 authentication → invalid_key", apiError(401, "authentication_error", "invalid x-api-key"), {
  code: "invalid_key",
  retryable: false,
  status: 400,
});

expect("403 permission denied → invalid_key", apiError(403, "permission_error", "not permitted"), {
  code: "invalid_key",
  retryable: false,
});

expect("429 rate limit → rate_limited", apiError(429, "rate_limit_error", "slow down"), {
  code: "rate_limited",
  retryable: true,
  status: 429,
});

expect("400 bad request → upstream_error, not retryable", apiError(400, "invalid_request_error", "max_tokens"), {
  code: "upstream_error",
  retryable: false,
});

expect("500 → upstream_error, retryable", apiError(500, "api_error", "internal"), {
  code: "upstream_error",
  retryable: true,
  status: 502,
});

expect("503 → upstream_error, retryable", apiError(503, "api_error", "unavailable"), {
  code: "upstream_error",
  retryable: true,
});

expect("529 overloaded → rate_limited", apiError(529, "overloaded_error", "overloaded"), {
  code: "rate_limited",
  retryable: true,
});

expect("connection failure → upstream_error", new APIConnectionError({ message: "socket hang up" }), {
  code: "upstream_error",
  retryable: true,
  status: 502,
});

expect("connection timeout → upstream_error", new APIConnectionTimeoutError({}), {
  code: "upstream_error",
  retryable: true,
});

expect("SDK abort → aborted", new APIUserAbortError({}), {
  code: "aborted",
  retryable: false,
  status: 499,
});

expect("DOMException AbortError → aborted", new DOMException("aborted", "AbortError"), {
  code: "aborted",
  retryable: false,
});

expect("fetch timeout → aborted", Object.assign(new Error("timed out"), { name: "TimeoutError" }), {
  code: "aborted",
  retryable: false,
});

expect("an unrecognised throw → unknown", new Error("something odd"), {
  code: "unknown",
  retryable: true,
  status: 500,
});

expect("a non-Error throw → unknown", "just a string", { code: "unknown", retryable: true });

process.stdout.write("\npass-through\n");

for (const code of ["missing_key", "unauthorized", "bad_request", "missing_files", "truncated_stream"]) {
  expect(`${code} is preserved, not reclassified`, new GenerationError(code, `${code} happened`), {
    code,
    retryable: code === "missing_files" || code === "truncated_stream",
  });
}

check("the message survives so the chat rail can show it", () => {
  const mapped = toGenerationError(apiError(429, "rate_limit_error", "slow down"));
  assert.match(mapped.message, /429/);
});

process.stdout.write("\nmodel constant\n");

check("the model id is a pinned, dateless Anthropic id", () => {
  assert.equal(GENERATION_MODEL, "claude-sonnet-5");
  assert.match(GENERATION_MODEL, /^claude-(opus|sonnet|haiku|fable)-\d/);
});

process.stdout.write("\nmodel selection\n");

check("real Anthropic ids are accepted, other vendors' are not", () => {
  for (const id of ["claude-opus-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]) {
    assert.equal(isModelId(id), true, `${id} should be a valid id`);
  }
  for (const id of ["gpt-4o", "claude", "claude-sonnet-5 ", "claude-sonnet-5/x", "", 5, null]) {
    assert.equal(isModelId(id), false, `${String(id)} should be rejected`);
  }
});

check("only the coding families are offered", () => {
  assert.equal(isSelectableModel("claude-opus-5"), true);
  assert.equal(isSelectableModel("claude-sonnet-5"), true);
  assert.equal(isSelectableModel("claude-haiku-4-5-20251001"), true);
  // A writing model is a real id, just not one to generate a storefront with.
  assert.equal(isSelectableModel("claude-fable-5"), false);
});

check("effort is sent to dateless ids and withheld from dated snapshots", () => {
  assert.equal(supportsEffort("claude-sonnet-5"), true);
  assert.equal(supportsEffort("claude-opus-5"), true);
  assert.equal(supportsEffort("claude-haiku-4-5-20251001"), false);
  assert.equal(supportsEffort("claude-sonnet-4-5-20250929"), false);
});

check("every fallback choice is a selectable id, and the default is among them", () => {
  for (const choice of FALLBACK_MODEL_CHOICES) {
    assert.equal(isSelectableModel(choice.id), true, `${choice.id} must be selectable`);
    assert.equal(choice.label.length > 0, true, `${choice.id} must have a label`);
  }
  assert.equal(
    FALLBACK_MODEL_CHOICES.some((choice) => choice.id === GENERATION_MODEL),
    true,
    "the default must be offered when the live list is unavailable",
  );
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
