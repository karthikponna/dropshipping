import { PAGE_ROUTES, getFramework } from "@/lib/framework";
import type {
  GenerationMemory,
  InheritedDesignContext,
  PageType,
  RecalledProjectContext,
  RecalledSource,
  Theme,
} from "@/lib/types";

import { MAX_CHROME_SOURCE_CHARS, MAX_RECALLED_SOURCE_CHARS, renderOrderedFileBlocks } from "./files";

/**
 * Renders what memory found into prompt text.
 *
 * Two different things arrive here and they are deliberately worded very
 * differently. An inherited design is a *constraint* — the product page belongs
 * to a shop that already has a look, and deviating from it is a bug. A recalled
 * project is a *reference* — the user gestured at something they built before,
 * and the model should carry its identity forward while still doing what the new
 * prompt asks. Blurring the two produces either a product page in fresh colours
 * or a rebuild that ignores the new instruction.
 *
 * A recalled project arrives at two strengths. With a theme alone it is the
 * weak form: same palette, same type, same voice, page rebuilt from scratch —
 * which is all "in the style of the last one" needs. With source attached it is
 * the strong form, and the instruction changes accordingly: the components
 * below are the page, and the new one is that page edited. That is the only
 * honest answer to "same UI, just change the name", and it is why the
 * investigation goes and reads them.
 */

/** The exact values the model must reuse, in the form it has to type them. */
function renderThemeContract(theme: Theme): string {
  const { colors, fonts } = theme;

  return [
    `<theme>${JSON.stringify(theme)}</theme>`,
    "",
    "Tailwind arbitrary values to reuse verbatim:",
    `- primary bg-[${colors.primary}] / text-[${colors.primary}]`,
    ...(colors.secondary ? [`- secondary bg-[${colors.secondary}]`] : []),
    ...(colors.accent ? [`- accent bg-[${colors.accent}] / text-[${colors.accent}]`] : []),
    ...(colors.background ? [`- page background bg-[${colors.background}]`] : []),
    ...(colors.foreground ? [`- body text text-[${colors.foreground}]`] : []),
    ...(colors.border ? [`- hairlines border-[${colors.border}]`] : []),
    `- headings font-['${fonts.heading.replace(/ /g, "_")}',serif]`,
    `- body copy font-['${fonts.body.replace(/ /g, "_")}',sans-serif]`,
    ...(theme.radius ? [`- corners: the Tailwind rounded-* step closest to ${theme.radius}, everywhere`] : []),
  ].join("\n");
}

const PAGE_LABEL: Record<string, string> = {
  landing: "landing page",
  product: "product page",
};

/**
 * The two components that belong to the shop rather than to either of its
 * pages.
 *
 * Named here rather than read off a framework because no framework marks them:
 * both list a Navbar and a Footer among their sections like any other slot, and
 * what makes these two different is a fact about the shop, not about the page.
 * `lib/ai/chrome.test.mjs` fails if either framework renames one, since a
 * silent miss means both pages go back to writing their own headers.
 */
export const CHROME_PATHS: readonly string[] = ["components/Navbar.tsx", "components/Footer.tsx"];

/**
 * The shop's header and footer, quoted as the files to emit back.
 *
 * The site-chrome contract in the system prompt already pins everything that
 * can be named — the link set, the ordering, the cart control, the four footer
 * sections. What it cannot pin is invented detail, and a footer is mostly
 * invented detail: a contact address, a returns window, a shipping line. Two
 * turns sharing no state cannot invent those the same way however carefully
 * they are instructed, because there is nothing to agree with. So this does not
 * describe the chrome, it hands over the code, and the only licensed edit is
 * the one thing that genuinely differs between routes.
 */
function renderChromeSource(chrome: readonly RecalledSource[], pageType: PageType): string {
  const route = PAGE_ROUTES[pageType];

  return [
    `THE SHOP'S CHROME — already written, on its ${PAGE_LABEL[pageType === "landing" ? "product" : "landing"]}. Emit these files back:`,
    renderOrderedFileBlocks(chrome, MAX_CHROME_SOURCE_CHARS),
    "",
    "Copy them out byte-for-byte, with exactly one change between them:",
    `- In ${chrome[0]?.path ?? "the navbar"}, aria-current="page" belongs on the link to ${route} — this route — and comes off the other one. The heavier weight or underline that marks the current link moves with it.`,
    "",
    "Nothing else moves. Same wordmark and same markup around it, same links in the same order with the same wording, same class lists, same spacing, same cart control. And every detail these files invented is the shop's, not this page's: the contact address, the returns window, the shipping line, the copyright, the footer description. Reuse them exactly as written. Writing a plausible alternative is the failure mode here — a visitor who sees a 14-day return policy on one route and 30 days on the other is looking at a broken shop, not a design variation.",
  ].join("\n");
}

export function renderInheritedDesign(inherited: InheritedDesignContext): string {
  const source = PAGE_LABEL[inherited.sourcePageType] ?? inherited.sourcePageType;
  const chrome = inherited.chrome ?? [];
  const thisPage: PageType = inherited.sourcePageType === "landing" ? "product" : "landing";

  return [
    `## THE SHOP ALREADY HAS A LOOK — match it exactly`,
    "",
    `This page belongs to ${inherited.shopName || "a shop"}, whose ${source} you already built. It is the same company, so the two pages must be indistinguishable in palette, type and shape. Do not re-art-direct.`,
    ...(inherited.summary ? ["", `What the shop sells: ${inherited.summary}`] : []),
    "",
    "REUSE THIS THEME — emit it back in your <theme> block unchanged:",
    renderThemeContract(inherited.theme),
    ...(inherited.sections.length > 0
      ? [
          "",
          // With the chrome quoted below there is nothing to infer about the
          // nav and footer, and describing them as well would invite the model
          // to reconcile a description against the code it was handed.
          chrome.length > 0
            ? `Sections already on the ${source}: ${inherited.sections.join(", ")}. Carry over its button shape and image treatment so the two pages feel like one site.`
            : `Sections already on the ${source}: ${inherited.sections.join(", ")}. Carry over its navigation wording, footer columns, button shape and image treatment so the two pages feel like one site.`,
        ]
      : []),
    ...(chrome.length > 0 ? ["", renderChromeSource(chrome, thisPage)] : []),
    "",
    "Keep the shop name, product names, prices and currency identical to what you established there. A different price for the same product on two pages is a bug.",
  ].join("\n");
}

/**
 * The page's own order: entry file, then sections top to bottom.
 *
 * Only matters when the character cap bites, and then it matters a lot, because
 * the cap drops from the end. What has to survive a truncation is the skeleton —
 * `app/page.tsx` says which sections exist and in what order — and after it the
 * sections nearest the top of the page, which are the ones carrying the brand
 * and setting the visual vocabulary for everything below. Falls back to filename
 * order when the page type is unknown, which puts the entry file first anyway.
 */
function byStructuralWeight(
  sources: readonly RecalledSource[],
  pageType?: PageType,
): RecalledSource[] {
  const framework = pageType ? getFramework(pageType) : null;
  const rank = new Map<string, number>();

  if (framework) {
    rank.set(framework.entryFile, 0);
    framework.components.forEach((component, index) => rank.set(component.path, index + 1));
  }

  const unranked = framework ? framework.components.length + 1 : 0;

  return [...sources].sort((left, right) => {
    const byRank = (rank.get(left.path) ?? unranked) - (rank.get(right.path) ?? unranked);
    return byRank !== 0 ? byRank : left.path.localeCompare(right.path);
  });
}

/**
 * The components of the recalled shop, quoted as the thing to edit.
 *
 * The wording has one job: stop the model treating this as inspiration. Given
 * a page and told to make another one like it, a model rewrites it — new
 * section copy, new spacing, a different hero — and the user who asked for "the
 * same UI" gets a different site in the same colours. Naming what must survive,
 * concretely and at the level of class lists and container widths, is what
 * turns it into an edit.
 */
function renderRecalledSource(sources: readonly RecalledSource[], pageType?: PageType): string {
  const page = pageType ? `${PAGE_LABEL[pageType] ?? pageType}` : "page";

  return [
    `ITS ACTUAL COMPONENTS — the code of that shop's ${page}, ${sources.length} of its files:`,
    renderOrderedFileBlocks(
      byStructuralWeight(sources, pageType),
      MAX_RECALLED_SOURCE_CHARS,
      (skipped) =>
        `TRUNCATED: ${skipped.length} more of that page's files exist and are not shown here — ` +
        `${skipped.join(", ")}. You are looking at part of that page, not all of it. Write those ` +
        "sections to sit with the ones you can see — same container width, same spacing rhythm, same " +
        "type scale, same class vocabulary — rather than art-directing them afresh.",
    ),
    "",
    "Build the new page by editing these, not by designing a new one that resembles them. Everything the new request does not ask you to change stays byte-for-byte: the same sections in the same order, the same layout and container widths, the same Tailwind class lists, the same spacing and type scale, the same image treatment, the same copy structure.",
    "",
    "Then apply what the new request does ask for, everywhere it reaches. A new brand name is never one file — it is the nav, the hero headline, the footer, the body copy, the <meta> block and any alt text or slug built from it. Where the new request and the code above disagree, the new request wins.",
    "",
    "These blocks are reference, not output: you must still emit every required file below, complete.",
  ].join("\n");
}

export function renderRecalledProject(recalled: RecalledProjectContext): string {
  const when = recalled.timePhrase ? ` from ${recalled.timePhrase}` : "";
  const sources = recalled.sources ?? [];

  return [
    `## YOU HAVE BUILT FOR THIS USER BEFORE`,
    "",
    `The request points back at an earlier shop${when}: "${recalled.name}".`,
    ...(recalled.summary ? [`What it was: ${recalled.summary}`] : []),
    ...(recalled.matchedConcepts.length > 0
      ? [`Matched on: ${recalled.matchedConcepts.join(", ")}.`]
      : []),
    "",
    "Its design system:",
    renderThemeContract(recalled.theme),
    "",
    ...(sources.length > 0
      ? [renderRecalledSource(sources, recalled.sourcePageType)]
      : [
          "Continue that shop rather than inventing a new one: same brand name, same palette, same type, same voice. Where the new request asks for something different, the new request wins — but everything it does not mention stays as it was.",
        ]),
  ].join("\n");
}

/** Both blocks, in the order the model should read them, or "" when empty. */
export function renderMemorySection(memory: GenerationMemory): string {
  const blocks: string[] = [];

  // Inherited design goes last so it sits closest to the instruction: it is the
  // harder constraint of the two when both are present.
  if (memory.recalled) blocks.push(renderRecalledProject(memory.recalled));
  if (memory.inherited) blocks.push(renderInheritedDesign(memory.inherited));

  return blocks.join("\n\n");
}
