/**
 * Pure helpers shared by the dashboard UI. No server imports live here, so
 * client components can use them too.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse relative time, rendered on the server only so the output stays
 * deterministic (locale is pinned for the same reason).
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";

  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${formatCount(Math.round(elapsed / MINUTE), "minute")} ago`;
  if (elapsed < DAY) return `${formatCount(Math.round(elapsed / HOUR), "hour")} ago`;
  if (elapsed < 2 * DAY) return "yesterday";
  if (elapsed < 30 * DAY) return `${formatCount(Math.round(elapsed / DAY), "day")} ago`;

  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatCount(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** `Good morning` / `Good afternoon` / `Good evening` for a given hour. */
export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const PROMPT_OPENERS =
  /^(please\s+)?(build|create|make|design|generate|i\s+want|i\s+need|build\s+me)\s+(me\s+)?(a|an|the)?\s*/i;

const MAX_NAME_LENGTH = 48;

/**
 * Turns a prompt into a project name: drops the "build me a…" opener, keeps the
 * first clause, caps it at six words.
 */
export function deriveProjectName(prompt: string, fallback = "Untitled shop"): string {
  const firstClause = prompt.trim().split(/[\n.!?]/)[0] ?? "";
  const cleaned = firstClause.replace(PROMPT_OPENERS, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return fallback;

  const words = cleaned.split(" ").slice(0, 6).join(" ");
  const trimmed =
    words.length > MAX_NAME_LENGTH ? `${words.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…` : words;

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
