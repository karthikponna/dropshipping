import { getFramework } from "@/lib/framework";
import { EMPTY_GENERATION_MEMORY } from "@/lib/types";
import type {
  FileMap,
  GenerationMemory,
  GenerationMode,
  ImageAsset,
  PageType,
  SessionTurn,
  Theme,
} from "@/lib/types";

import { buildModeSection } from "./base";
import { renderFileBlocks } from "./files";
import { buildLandingSystemPrompt } from "./landing";
import { renderMemorySection } from "./memory";
import { buildProductSystemPrompt } from "./product";

export { buildBaseSystemPrompt, buildModeSection } from "./base";
export { MAX_FILE_CONTEXT_CHARS, MAX_RECALLED_SOURCE_CHARS, renderFileBlocks } from "./files";
export { buildLandingSystemPrompt } from "./landing";
export { renderInheritedDesign, renderMemorySection, renderRecalledProject } from "./memory";
export { buildProductSystemPrompt } from "./product";

/**
 * The system prompt for one generation turn. Page type picks the prompt file;
 * mode appends the create/refine contract; attachments swap the image rules
 * from placeholders to the user's own photos.
 */
export function buildSystemPrompt(
  pageType: PageType,
  mode: GenerationMode,
  hasAttachments = false,
): string {
  const base =
    pageType === "product"
      ? buildProductSystemPrompt(hasAttachments)
      : buildLandingSystemPrompt(hasAttachments);
  return [base, "", buildModeSection(mode)].join("\n");
}

/**
 * The manifest of attached photos for the user turn.
 *
 * The pictures themselves are separate content blocks; this is the part the
 * model has to copy from, so each one is numbered in the same order the images
 * were attached and carries the exact `src`, plus the dimensions the markup
 * needs. Naming the file helps more than it looks — "matte-black-bottle.jpg"
 * tells the model what it is looking at when the photo is ambiguous.
 */
function renderAttachments(attachments: readonly ImageAsset[]): string {
  if (attachments.length === 0) return "";

  const lines = attachments.map((asset, index) => {
    const dimensions =
      asset.width > 0 && asset.height > 0 ? ` — ${asset.width}×${asset.height}` : "";
    return [
      `${index + 1}. ${asset.name}${dimensions}`,
      `   src: ${asset.url}`,
    ].join("\n");
  });

  return [
    `ATTACHED PHOTOS — ${attachments.length} image${attachments.length === 1 ? "" : "s"} of the real product, shown above this text in this order:`,
    ...lines,
    "",
    "Use each of these URLs exactly as written, at least once, in the most prominent frame it suits. Take the palette and every physical description from what you can see in them. Fall back to picsum only for images the user did not supply.",
  ].join("\n");
}

function quoteBlock(text: string): string {
  return ['"""', text.trim(), '"""'].join("\n");
}

/** The user turn for `mode: "create"`. */
export function buildCreateMessage(
  pageType: PageType,
  prompt: string,
  memory: GenerationMemory = EMPTY_GENERATION_MEMORY,
  attachments: readonly ImageAsset[] = [],
  plan = "",
): string {
  const framework = getFramework(pageType);
  const memorySection = renderMemorySection(memory);
  const attachmentSection = renderAttachments(attachments);
  const brief = plan.trim();

  return [
    `Build a ${framework.label.toLowerCase()} for this shop.`,
    "",
    "SHOP DESCRIPTION:",
    quoteBlock(prompt),
    ...(attachmentSection.length > 0 ? ["", attachmentSection] : []),
    ...(memorySection.length > 0 ? ["", memorySection] : []),
    // The brief comes from a pass that matched the request against the dates of
    // every past shop and then opened the components quoted above. It sits
    // between the reference and the emission contract, which is where a reader
    // needs it: after the code, before being told to write.
    ...(brief.length > 0
      ? ["", "WHAT TO CARRY OVER — from a pass over that shop's history and source:", quoteBlock(brief)]
      : []),
    "",
    `Emit <meta>, then <theme>, then all ${framework.requiredFiles.length} required files in the listed order:`,
    framework.requiredFiles.map((path) => `- ${path}`).join("\n"),
    "",
    "Start your reply with <meta>. No preamble.",
  ].join("\n");
}

/**
 * The sitting so far, as the graph recorded it.
 *
 * Without this the tenth instruction of a session is read as if it were the
 * first: "make it narrower" has no referent, and an earlier decision the user
 * already settled — a colour, a section that was deliberately removed — gets
 * quietly undone. Only what was asked for is rendered, not what came back; the
 * current files are the record of that, and repeating them would be noise.
 */
export function renderSessionHistory(history: readonly SessionTurn[]): string {
  if (history.length === 0) return "";

  const lines = history.map((turn, index) => {
    const page = turn.pageType === "product" ? "product page" : "landing page";
    return `${index + 1}. (${page}) ${turn.prompt}`;
  });

  return [
    "EARLIER IN THIS SESSION — what the user has already asked for, oldest first:",
    ...lines,
    "",
    "Read the change below against these. Do not undo something an earlier turn asked for unless this one says to.",
  ].join("\n");
}

export interface RefineMessageInput {
  pageType: PageType;
  instruction: string;
  files: FileMap;
  theme: Theme;
  /**
   * The subset of `files` worth showing — the files Claude opened while
   * investigating, or failing that the component graph's guess. Null means show
   * everything.
   */
  contextPaths?: readonly string[] | null;
  /** Images attached to this turn — usually new photos to work into the page. */
  attachments?: readonly ImageAsset[];
  /** Turns already generated in this sitting, from the memory graph. */
  history?: readonly SessionTurn[];
  /** The investigation turn's brief on what this change touches. */
  plan?: string;
}

/** The user turn for `mode: "refine"` — current tree plus the change asked for. */
export function buildRefineMessage({
  pageType,
  instruction,
  files,
  theme,
  contextPaths,
  attachments = [],
  history = [],
  plan,
}: RefineMessageInput): string {
  const framework = getFramework(pageType);

  const shown =
    contextPaths && contextPaths.length > 0
      ? Object.fromEntries(
          Object.entries(files).filter(([path]) => contextPaths.includes(path)),
        )
      : files;

  const withheld = Object.keys(files)
    .filter((path) => shown[path] === undefined)
    .sort();

  const historySection = renderSessionHistory(history);
  const brief = plan?.trim() ?? "";

  return [
    `This is an existing ${framework.label.toLowerCase()}. Apply one change to it.`,
    ...(historySection.length > 0 ? ["", historySection] : []),
    "",
    "CURRENT THEME:",
    `<theme>${JSON.stringify(theme)}</theme>`,
    "",
    withheld.length > 0 ? "FILES RELEVANT TO THIS CHANGE:" : "CURRENT FILES:",
    renderFileBlocks(shown),
    ...(withheld.length > 0
      ? [
          "",
          // Naming them matters: the model has to know these exist so it does
          // not recreate a section that is already on the page.
          `ALSO ON THIS PAGE, unchanged and not shown: ${withheld.join(", ")}. Leave them alone and do not emit them.`,
        ]
      : []),
    "",
    "CHANGE REQUESTED:",
    quoteBlock(instruction),
    ...(attachments.length > 0 ? ["", renderAttachments(attachments)] : []),
    // The brief comes from a pass that read the session history and opened these
    // exact files. It goes last, next to the instruction it interprets, so it is
    // the freshest thing in context when the model starts writing.
    ...(brief.length > 0
      ? ["", "WHAT THAT MEANS HERE — from a pass over this shop's history and source:", quoteBlock(brief)]
      : []),
    "",
    "Re-emit only the files this change touches, each complete, as <file> blocks. Every file you leave out stays exactly as it is above. Start your reply with the first tag. No preamble.",
  ].join("\n");
}

export interface RepairMessageInput {
  pageType: PageType;
  missing: readonly string[];
  files: FileMap;
  theme: Theme;
  /** Carried into the repair so a regenerated gallery keeps the real photos. */
  attachments?: readonly ImageAsset[];
}

/**
 * The one targeted follow-up when required files never arrived. It asks for
 * exactly the missing paths and shows what already exists so the repaired files
 * match the palette, wording and product details of their siblings.
 */
export function buildRepairMessage({
  pageType,
  missing,
  files,
  theme,
  attachments = [],
}: RepairMessageInput): string {
  const framework = getFramework(pageType);
  const present = Object.keys(files).sort();

  return [
    `The ${framework.label.toLowerCase()} is incomplete: ${missing.length} required file${
      missing.length === 1 ? "" : "s"
    } never arrived.`,
    "",
    "MISSING FILES — emit exactly these and nothing else:",
    missing.map((path) => `- ${path}`).join("\n"),
    ...(attachments.length > 0 ? ["", renderAttachments(attachments)] : []),
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
