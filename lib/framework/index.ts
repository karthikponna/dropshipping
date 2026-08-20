import { PAGE_TYPE_LABELS, type FileMap, type PageFramework, type PageType } from "@/lib/types";

import { landingFramework } from "./landing";
import { productFramework } from "./product";
import { PAGE_ROUTES, SITE_ROUTES } from "./routes";

export { landingFramework, LANDING_COMPONENTS, LANDING_REQUIRED_FILES } from "./landing";
export { productFramework, PRODUCT_COMPONENTS, PRODUCT_REQUIRED_FILES } from "./product";
export {
  PAGE_ROUTES,
  PAGE_ROUTE_SEGMENTS,
  SITE_ROUTES,
  pageTypeForHref,
} from "./routes";

export const FRAMEWORKS: Record<PageType, PageFramework> = {
  landing: landingFramework,
  product: productFramework,
};

export function getFramework(pageType: PageType): PageFramework {
  return FRAMEWORKS[pageType];
}

/** Required files the model did not emit. Empty array means the tree is complete. */
export function missingRequiredFiles(pageType: PageType, files: FileMap): string[] {
  const framework = getFramework(pageType);
  return framework.requiredFiles.filter((path) => {
    const contents = files[path];
    return typeof contents !== "string" || contents.trim().length === 0;
  });
}

/**
 * The manifest rendered as prompt text. Drop this into the system prompt so the
 * model fills exactly these slots.
 */
export function renderFrameworkBrief(pageType: PageType): string {
  const framework = getFramework(pageType);

  const files = framework.requiredFiles.map((path) => `- ${path}`).join("\n");

  const components = framework.components
    .map((component) => {
      const requirements = component.requirements.map((line) => `    - ${line}`).join("\n");
      return [
        `- ${component.path} — ${component.purpose}`,
        `    ${component.signature}`,
        requirements,
      ].join("\n");
    })
    .join("\n");

  const guidance = framework.promptGuidance.map((line) => `- ${line}`).join("\n");

  return [
    `PAGE TYPE: ${framework.label} (${framework.pageType})`,
    framework.description,
    "",
    "REQUIRED FILES — emit every one of these, and nothing else:",
    files,
    "",
    `COMPOSITION ORDER inside ${framework.entryFile}:`,
    framework.composition.join(" → "),
    "",
    "COMPONENT SLOTS:",
    components,
    "",
    "RULES:",
    guidance,
  ].join("\n");
}

/**
 * The half of the brief that is about the *shop* rather than this page.
 *
 * Each page type is generated on its own, in its own turn, into its own tree —
 * so nothing downstream can make two independently written pages share a
 * navigation bar. What can is a contract tight enough that two separate
 * generations converge on the same chrome: fixed routes, fixed link wording,
 * and the rule that the header must be writable unchanged on either route.
 * Anything the brief leaves open, the two turns fill differently — the header's
 * trailing slot diverged (a "Shop now" button against a cart glyph) until it was
 * named here, so it is pinned to one control rather than left to taste.
 * Combined with the inherited palette and type the memory graph already
 * supplies, that is what makes the pair read as one site.
 *
 * The route list is rendered from `PAGE_ROUTES`, so the hrefs the model is told
 * to write are the same ones the export mounts the pages at.
 */
export function renderSiteChromeBrief(pageType: PageType): string {
  const routes = SITE_ROUTES.map(({ pageType: type, path }) => {
    const here = type === pageType ? "  ← the page you are writing now" : "";
    return `- ${path} — ${PAGE_TYPE_LABELS[type].toLowerCase()}${here}`;
  }).join("\n");

  const others = SITE_ROUTES.filter((route) => route.pageType !== pageType);
  const elsewhere = others.map((route) => route.path).join(", ");

  return [
    "THIS PAGE IS ONE ROUTE OF A SHOP, NOT A STANDALONE PAGE",
    "",
    "The shop's routes are fixed and both of them always exist in the finished site, so a link to the other route is never a dead link:",
    routes,
    "",
    "Navbar and Footer are the SHOP's chrome, not this page's decoration. Write them so the identical markup would be correct on every route:",
    "- The wordmark is the shop name, wrapped in <a href=\"/\">.",
    `- The nav carries one link per route and NOTHING ELSE, in route order, with exactly this wording: ${SITE_ROUTES.map(({ pageType: type, path }) => `<a href="${path}">${type === "landing" ? "Home" : "Shop"}</a>`).join(", ")}.`,
    '- A link to a section of a page ("#features", "#specs", "#reviews") never goes in the chrome — not in the nav, not in the footer. The chrome is identical on every route and a section exists on only one of them, so the same fragment would be dead on the other. A jump link to a section of this page goes in this page\'s body.',
    `- The link for the current route (${PAGE_ROUTES[pageType]}) gets aria-current="page" and a heavier weight or an underline. The others are plain.`,
    '- The right-hand end of the header holds exactly one control, on every route: <button type="button" aria-label="Cart">, showing a cart glyph and the item count. Nothing else goes there — no second button, no "Shop now" anchor, no search, no account link.',
    "- This page's own call to action belongs in its body — the hero, a closing band — never in the shop's header.",
    '- The footer carries the wordmark, a one-line shop description, exactly two link columns — "Shop", repeating the route links in route order, then "Support", listing shipping, returns and contact as plain text — and a copyright line naming the shop. Same columns, same headings, same wording, same order on every route.',
    "- Chrome geometry is identical across routes: same header height, same padding, same border, same wordmark size, same link size, same hover treatment. A visitor moving between routes must not see the header shift.",
    "",
    "LINK RULES — a broken cross-page link is a failed generation:",
    `- A link to another route of this shop is a plain anchor with a leading slash: <a href="${elsewhere}">. Never href="#" for a route, never a relative path, never an external URL.`,
    "- Anchors to a section of the page you are on stay fragments: href=\"#features\".",
    "- Buttons that do something local (add to cart, change quantity, pick a thumbnail) stay <button>. Only navigation is an anchor.",
  ].join("\n");
}
