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

/**
 * The model that investigates before a refinement is written.
 *
 * Same model as the writing turn on purpose. The investigation reads source and
 * decides what a vague instruction refers to, which is the judgement-heavy part
 * of a refinement — a cheaper model here would pick the wrong files and cost
 * more than it saved. Point it at a smaller id if the latency ever matters more
 * than the accuracy.
 */
export const INVESTIGATION_MODEL = GENERATION_MODEL;

/**
 * Thinking effort for the investigation turn.
 *
 * Sent explicitly because the default is `high`, and thinking is billed against
 * the same `max_tokens` as the reply: a high-effort round would spend its whole
 * budget reasoning and return a message with no text block at all, which the
 * tool loop reads as an empty brief. That failure is invisible — the generation
 * carries on without a plan — so the effort is pinned low, where the work is
 * choosing which files to open rather than reasoning about their contents.
 */
export const INVESTIGATION_EFFORT: "low" | "medium" | "high" | "xhigh" | "max" | null = "low";

/**
 * The investigation only ever writes a short brief; the files are its input.
 * The ceiling is well above what the brief needs so that a round which thinks
 * more than expected still has room to say something.
 */
export const INVESTIGATION_MAX_TOKENS = 6_000;

/**
 * Tool rounds the investigation gets. Claude issues parallel tool calls, so the
 * usual shape is one round to look around, one to read what it found, and a
 * third to write the brief. Four leaves room for a follow-up without letting a
 * confused run sit in front of the user's page.
 */
export const INVESTIGATION_MAX_ROUNDS = 4;

/** Ceiling on the whole investigation, after which the refinement proceeds without it. */
export const INVESTIGATION_TIMEOUT_MS = 90 * 1000;

/** Hard ceiling on a single Anthropic request, in milliseconds. */
export const GENERATION_TIMEOUT_MS = 8 * 60 * 1000;

/** Transport-level retries inside the SDK (network blips, 429s, 5xx). */
export const GENERATION_MAX_RETRIES = 2;
