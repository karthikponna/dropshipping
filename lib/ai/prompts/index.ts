import { getFramework } from "@/lib/framework";
import type { FileMap, GenerationMode, PageType, Theme } from "@/lib/types";

import { buildModeSection } from "./base";
import { buildLandingSystemPrompt } from "./landing";
import { buildProductSystemPrompt } from "./product";

export { buildBaseSystemPrompt, buildModeSection } from "./base";
export { buildLandingSystemPrompt } from "./landing";
export { buildProductSystemPrompt } from "./product";

/**
 * The system prompt for one generation turn. Page type picks the prompt file;
 * mode appends the create/refine contract.
 */
export function buildSystemPrompt(pageType: PageType, mode: GenerationMode): string {
  const base = pageType === "product" ? buildProductSystemPrompt() : buildLandingSystemPrompt();
  return [base, "", buildModeSection(mode)].join("\n");
}

/** Roughly four characters per token — enough to keep a prompt inside budget. */
const MAX_FILE_CONTEXT_CHARS = 120_000;

/** Renders a FileMap back into the same `<file>` blocks the model must emit. */
function renderFileBlocks(files: FileMap, limitChars = MAX_FILE_CONTEXT_CHARS): string {
  const blocks: string[] = [];
  const skipped: string[] = [];
  let used = 0;

  for (const path of Object.keys(files).sort()) {
    const contents = files[path] ?? "";
    const block = `<file path="${path}">\n${contents.replace(/\s+$/, "")}\n</file>`;
    if (used + block.length > limitChars && blocks.length > 0) {
      skipped.push(path);
      continue;
    }
    blocks.push(block);
    used += block.length;
  }

  if (skipped.length > 0) {
    blocks.push(`(omitted for length, keep them untouched: ${skipped.join(", ")})`);
  }

  return blocks.join("\n\n");
}

function quoteBlock(text: string): string {
  return ['"""', text.trim(), '"""'].join("\n");
}

/** The user turn for `mode: "create"`. */
export function buildCreateMessage(pageType: PageType, prompt: string): string {
  const framework = getFramework(pageType);

  return [
    `Build a ${framework.label.toLowerCase()} for this shop.`,
    "",
    "SHOP DESCRIPTION:",
    quoteBlock(prompt),
    "",
    `Emit <meta>, then <theme>, then all ${framework.requiredFiles.length} required files in the listed order:`,
    framework.requiredFiles.map((path) => `- ${path}`).join("\n"),
    "",
    "Start your reply with <meta>. No preamble.",
  ].join("\n");
}

export interface RefineMessageInput {
  pageType: PageType;
  instruction: string;
  files: FileMap;
  theme: Theme;
}

/** The user turn for `mode: "refine"` — current tree plus the change asked for. */
export function buildRefineMessage({ pageType, instruction, files, theme }: RefineMessageInput): string {
  const framework = getFramework(pageType);

  return [
    `This is an existing ${framework.label.toLowerCase()}. Apply one change to it.`,
    "",
    "CURRENT THEME:",
    `<theme>${JSON.stringify(theme)}</theme>`,
    "",
    "CURRENT FILES:",
    renderFileBlocks(files),
    "",
    "CHANGE REQUESTED:",
    quoteBlock(instruction),
    "",
    "Re-emit only the files this change touches, each complete, as <file> blocks. Every file you leave out stays exactly as it is above. Start your reply with the first tag. No preamble.",
  ].join("\n");
}

export interface RepairMessageInput {
  pageType: PageType;
  missing: readonly string[];
  files: FileMap;
  theme: Theme;
}

/**
 * The one targeted follow-up when required files never arrived. It asks for
 * exactly the missing paths and shows what already exists so the repaired files
 * match the palette, wording and product details of their siblings.
 */
export function buildRepairMessage({ pageType, missing, files, theme }: RepairMessageInput): string {
  const framework = getFramework(pageType);
  const present = Object.keys(files).sort();

  return [
    `The ${framework.label.toLowerCase()} is incomplete: ${missing.length} required file${
      missing.length === 1 ? "" : "s"
    } never arrived.`,
    "",
    "MISSING FILES — emit exactly these and nothing else:",
    missing.map((path) => `- ${path}`).join("\n"),
    "",
    "THEME ALREADY IN USE (reuse these exact values):",
    `<theme>${JSON.stringify(theme)}</theme>`,
    "",
    present.length > 0
      ? [
          "FILES THAT ALREADY EXIST (match their palette, fonts, product name, prices and tone exactly):",
          renderFileBlocks(files),
        ].join("\n")
      : "Nothing was salvaged from the previous attempt, so establish the product details yourself and keep them consistent across the files you emit.",
    "",
    "Emit only the missing files listed above, each as a complete <file> block. Do not re-emit an existing file, do not emit <meta> or <theme>, do not explain. Start your reply with the first <file> tag.",
  ].join("\n");
}
