/**
 * A stable id for the current sitting.
 *
 * The memory graph groups generations into sessions so it can tell "these were
 * built in one go" from "these are weeks apart" — which is what makes a phrase
 * like "the site I made yesterday" resolvable at all. `sessionStorage` is
 * exactly the right lifetime: it survives navigation and reloads within the tab,
 * and a genuinely new sitting in a new tab gets a genuinely new id.
 */

const STORAGE_KEY = "dropshipping.session-id";

let cached: string | null = null;

function mint(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  if (cached) return cached;

  // Server-rendered calls get a throwaway id; only the browser starts runs.
  if (typeof window === "undefined") return mint();

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }

    const fresh = mint();
    window.sessionStorage.setItem(STORAGE_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // Private browsing can refuse sessionStorage. An in-memory id still groups
    // this page's runs correctly, it just does not survive a reload.
    cached = mint();
    return cached;
  }
}
