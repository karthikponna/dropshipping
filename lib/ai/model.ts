/**
 * Every Anthropic knob in one place. Swapping the model is a one-line change
 * here and nowhere else — no other module names a model.
 */

/**
 * Claude Sonnet 5 (`claude-sonnet-5`) — Anthropic's current dateless model id
 * for the Sonnet 5 generation, positioned for code generation at scale. Model
 * ids from the 4.6 generation onward carry no date suffix and are pinned
 * snapshots, so this string does not drift under us.
 *
 * This is the default the app generates with. A user can pick another from the
 * composer, in which case their choice arrives on the request body — see
 * `isModelId` for what the server will accept.
 */
export const GENERATION_MODEL = "claude-sonnet-5";

/* ─────────────────────────── choosing a model ───────────────────────────── */

/** One selectable model, as the dropdown needs it. */
export interface ModelChoice {
  id: string;
  /** Anthropic's own `display_name`, e.g. "Claude Sonnet 5". */
  label: string;
}

/** Body of `GET /api/models`. */
export interface ModelsResponse {
  models: ModelChoice[];
  /** `"live"` when Anthropic answered, `"fallback"` when the built-in list stood in. */
  source: "live" | "fallback";
}

/**
 * Families worth offering for this job. Anthropic's catalogue also carries
 * models tuned for other work — `claude-fable-5` is a writing model, not a
 * coding one — and listing them in a storefront generator would only invite a
 * disappointing run. Widen this if a new coding family appears.
 */
const CODING_FAMILIES = /^claude-(opus|sonnet|haiku)-/;

/**
 * Shown when `GET /api/models` cannot answer — a missing key, a network blip, a
 * 403 on a restricted key. Real ids, so picking one still works; the live list
 * is preferred because a user's own key may reach models this list does not
 * name.
 */
export const FALLBACK_MODEL_CHOICES: readonly ModelChoice[] = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

/** True for something shaped like an Anthropic model id. */
export function isModelId(value: unknown): value is string {
  return typeof value === "string" && /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value) && value.length <= 64;
}

/** True for a model this app is willing to put in front of a user. */
export function isSelectableModel(id: string): boolean {
  return isModelId(id) && CODING_FAMILIES.test(id);
}

/**
 * Whether `output_config.effort` can be sent to this model.
 *
 * Effort arrived with the 4.6 generation, which is also when Anthropic stopped
 * date-stamping ids — so a trailing `-YYYYMMDD` marks a snapshot old enough to
 * reject the field outright. Sending it anyway costs a 400 on exactly the
 * models a user picks when they want something cheaper.
 */
export function supportsEffort(model: string): boolean {
  return !/-\d{8}$/.test(model);
}

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
 * Same model as the writing turn on purpose, including when the user picks one:
 * the investigation reads source and decides what a vague instruction refers
 * to, which is the judgement-heavy part of a refinement — a cheaper model here
 * would pick the wrong files and cost more than it saved. This constant is only
 * the default for a request that names no model.
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
