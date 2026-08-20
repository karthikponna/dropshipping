import type { FileMap } from "@/lib/types";

/**
 * Rendering a tree back into the `<file>` blocks the model emits.
 *
 * Its own module because two very different prompts quote source now — a
 * refinement quotes the page it is editing, and a create turn quotes the shop it
 * is copying — and the second one lives in `memory.ts`, which `index.ts`
 * imports. Sharing it any other way would be a cycle.
 */

/** Roughly four characters per token — enough to keep a prompt inside budget. */
export const MAX_FILE_CONTEXT_CHARS = 120_000;

/**
 * How much of a *past* shop may be quoted as reference.
 *
 * Sized to hold a whole page rather than a sample of one. "Take the same UI" is
 * answered by every section the user can see, and a page delivered with four of
 * its seven sections rewritten from a description of them is exactly the drift
 * this exists to prevent — so the file budget is generous and this is the
 * backstop behind it, not the thing doing the choosing. A full shop is around
 * 60k characters, which leaves half again as much headroom before anything is
 * dropped; it bites only on a shop far larger than any the app produces.
 */
export const MAX_RECALLED_SOURCE_CHARS = 90_000;

/**
 * Two components, quoted so a sibling page can emit them back unchanged. Wide
 * enough that a header and footer never truncate — a half-quoted footer is
 * worse than none, because the model completes it from imagination and the
 * result looks deliberate.
 */
export const MAX_CHROME_SOURCE_CHARS = 24_000;

/** One file's contents, in the order the caller wants it quoted. */
export interface FileBlock {
  path: string;
  contents: string;
}

function defaultOmissionNote(paths: readonly string[]): string {
  return `(omitted for length, keep them untouched: ${paths.join(", ")})`;
}

/** Renders a FileMap back into the same `<file>` blocks the model must emit. */
export function renderFileBlocks(
  files: FileMap,
  limitChars = MAX_FILE_CONTEXT_CHARS,
  omissionNote: (paths: readonly string[]) => string = defaultOmissionNote,
): string {
  const entries = Object.keys(files)
    .sort()
    .map((path) => ({ path, contents: files[path] ?? "" }));

  return renderOrderedFileBlocks(entries, limitChars, omissionNote);
}

/**
 * The same, quoting in the order given and dropping from the end.
 *
 * Alphabetical order is harmless while everything fits, and the wrong answer
 * the moment it does not: the cap drops the tail, and a tail chosen by filename
 * throws away `app/page.tsx` to keep `components/CTA.tsx`. A caller that knows
 * which files carry the structure of the page passes them first.
 */
export function renderOrderedFileBlocks(
  entries: readonly FileBlock[],
  limitChars = MAX_FILE_CONTEXT_CHARS,
  omissionNote: (paths: readonly string[]) => string = defaultOmissionNote,
): string {
  const blocks: string[] = [];
  const skipped: string[] = [];
  let used = 0;

  for (const { path, contents } of entries) {
    const block = `<file path="${path}">\n${contents.replace(/\s+$/, "")}\n</file>`;
    if (used + block.length > limitChars && blocks.length > 0) {
      skipped.push(path);
      continue;
    }
    blocks.push(block);
    used += block.length;
  }

  if (skipped.length > 0) {
    blocks.push(omissionNote(skipped));
  }

  return blocks.join("\n\n");
}
