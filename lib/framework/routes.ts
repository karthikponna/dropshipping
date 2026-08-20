import { PAGE_TYPES, type PageType } from "@/lib/types";

/**
 * Where each page of a shop lives once the shop is one site.
 *
 * A project holds one tree per page type and both trees write `app/page.tsx`,
 * so nothing in the generator knows about routes — the route only appears when
 * the two trees are composed. That happens in three places, and they have to
 * agree or a working link becomes a 404:
 *
 *   - the export relocates the secondary page into its own segment,
 *   - the prompts tell the model which href to write for a cross-page link,
 *   - the preview resolves a clicked href back to the page type to render.
 *
 * This is the one map all three read. The landing page owns `/` because that is
 * what a visitor lands on; every other page type takes a segment of its own.
 */
export const PAGE_ROUTES: Record<PageType, string> = {
  landing: "/",
  product: "/product",
};

/**
 * Directory segment a page type is relocated into when it is *not* the root
 * page of the export. `landing` has one only because a shop with a product page
 * and no landing page still has to put the product page at the root.
 */
export const PAGE_ROUTE_SEGMENTS: Record<PageType, string> = {
  landing: "home",
  product: "product",
};

/** Every route of a finished shop, in the order a visitor meets them. */
export const SITE_ROUTES: ReadonlyArray<{ pageType: PageType; path: string }> = PAGE_TYPES.map(
  (pageType) => ({ pageType, path: PAGE_ROUTES[pageType] }),
);

/**
 * The page type an in-site href resolves to, or null for anything else.
 *
 * Deliberately strict about what counts as in-site: a leading slash and a path
 * that matches a known route once its query and fragment are dropped. A bare
 * fragment (`#features`) is an anchor within the page the visitor is already on
 * and must keep its native behaviour, and an absolute URL belongs to somebody
 * else's site.
 */
export function pageTypeForHref(href: string): PageType | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return null;

  const path = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const normalized = path.length === 0 ? "/" : path;

  for (const pageType of PAGE_TYPES) {
    if (PAGE_ROUTES[pageType] === normalized) return pageType;
  }
  return null;
}
