/**
 * Module resolve hook used only by `run-tests.mjs`.
 *
 * Mirrors the two tsconfig behaviours Node's loader lacks: the `@/*` alias that
 * points at the repository root, and extension-less relative specifiers, which
 * are resolved against `.ts` / `.tsx` before falling back to Node's own logic.
 */

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensions = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function firstExistingFile(basePath) {
  for (const extension of extensions) {
    const candidate = `${basePath}${extension}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Candidate does not exist; try the next extension.
    }
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  let basePath = null;

  if (specifier.startsWith("@/")) {
    basePath = path.join(repoRoot, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    basePath = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }

  if (basePath !== null) {
    const resolved = firstExistingFile(basePath);
    if (resolved !== null) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
