import { resolve as aliasResolve } from "../lib/ai/alias-hooks.mjs";

/**
 * The project's `@/*` alias plus one extra case.
 *
 * `lib/ai/past-project.ts` imports `lib/supabase/server.ts`, which imports
 * `next/headers` at module scope. Next ships that as a plain `headers.js` with
 * no exports map, so bare ESM resolution misses it and the import throws before
 * anything runs. Pointing at the file directly loads the real module; the read
 * under test takes its client as an argument and never calls into it.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") return nextResolve("next/headers.js", context);
  return aliasResolve(specifier, context, nextResolve);
}
