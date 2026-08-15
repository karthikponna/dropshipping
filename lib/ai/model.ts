/**
 * Every Anthropic knob in one place. Swapping the model is a one-line change
 * here and nowhere else — no other module names a model.
 */

/**
 * Claude Sonnet 5 (`claude-sonnet-5`) — Anthropic's current dateless model id
 * for the Sonnet 5 generation, positioned for code generation at scale. Model
 * ids from the 4.6 generation onward carry no date suffix and are pinned
 * snapshots, so this string does not drift under us.
 */
export const GENERATION_MODEL = "claude-sonnet-5";

/**
 * Output ceiling for a create/refine turn. A full page type is 8 files of
 * roughly 100–200 lines, which lands well inside this; the ceiling exists so a
 * runaway generation fails fast instead of burning the budget.
 */
export const GENERATION_MAX_TOKENS = 32_000;

/** A repair turn only re-emits the handful of files that went missing. */
export const REPAIR_MAX_TOKENS = 12_000;

/**
 * Thinking effort. Sonnet 5 defaults to `high`, which delays the first visible
 * token; `medium` keeps the live preview feeling immediate while still letting
 * the model plan the page before it writes. Set to `null` to send no
 * `output_config` at all and take the model's default.
 */
export const GENERATION_EFFORT: "low" | "medium" | "high" | "xhigh" | "max" | null = "medium";

/** Hard ceiling on a single Anthropic request, in milliseconds. */
export const GENERATION_TIMEOUT_MS = 8 * 60 * 1000;

/** Transport-level retries inside the SDK (network blips, 429s, 5xx). */
export const GENERATION_MAX_RETRIES = 2;
