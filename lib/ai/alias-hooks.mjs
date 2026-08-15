import { statSync } from "node:fs";

/**
 * Node module-resolution hook for the two things bundlers do for us that plain
 * `node` does not: the project's `@/*` alias, and extensionless relative imports
 * (`./landing` → `./landing.ts`). With it registered, the TypeScript sources under
 * lib/ can be imported directly by the .mjs test scripts — Node strips the types
 * itself, so there is no build step and no dependency.
 *
 * Registered from each test file:
 *   register("./alias-hooks.mjs", import.meta.url)
 */

const ROOT = new URL("../../", import.meta.url);
const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx", "/index.js"];

function isFile(url) {
  try {
    return statSync(url).isFile();
  } catch {
    return false;
  }
}

/** First existing file among `base` and `base` + each known suffix. */
function findFile(base) {
  if (isFile(base)) return base;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = new URL(`${base.pathname}${suffix}`, base);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = findFile(new URL(specifier.slice(2), ROOT));
    if (!found) throw new Error(`Cannot resolve aliased specifier "${specifier}" from ${ROOT.href}`);
    return { url: found.href, shortCircuit: true };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const found = findFile(new URL(specifier, context.parentURL));
    if (found) return { url: found.href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
