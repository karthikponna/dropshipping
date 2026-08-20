import { buildBaseSystemPrompt } from "./base";

/**
 * The product-page system prompt. Separate from the landing prompt on purpose:
 * different required files, a different layout skeleton, and a different job to
 * do — this page sells one specific item, not a brand.
 */

const PRODUCT_DIRECTION = `## PRODUCT PAGE DIRECTION

This is a single-product detail page. Its only job is to get one specific item into the cart.

One product, told consistently
- Invent ONE product and commit to it: one name, one price, one material story, one set of images. Gallery, ProductInfo, PriceBlock, AddToCart, Specs and Reviews must all describe that same product with the same name and the same price.
- Contradicting yourself between components — a different price in PriceBlock than in AddToCart, a different product name in Reviews — is the most common failure on this page type. Check before you close each file.
- Every value is concrete: real dimensions, material names, weight, capacity, care instructions, shipping window, review dates.

Layout
- Above the fold is a two-column split inside app/page.tsx: grid grid-cols-1 lg:grid-cols-2 with Gallery on the left and ProductInfo, PriceBlock and AddToCart stacked in the right column. Below lg it collapses to one column with Gallery first.
- Specs and Reviews sit full width beneath the split, then Footer.
- The right column stays readable at narrow widths: no fixed pixel widths, no horizontal scroll.

Interactivity
- Gallery starts with "use client": one large main image plus 3–4 thumbnails, selection held in useState, the active thumbnail marked with a ring in the primary colour. Hold the frame with Tailwind aspect utilities (aspect-square or aspect-[4/5]) and object-cover.
- AddToCart starts with "use client": a quantity stepper in useState clamped to a sane minimum of 1, a full-width primary "Add to cart" button, a secondary "Buy now", and one line of returns or guarantee microcopy underneath. Nothing calls a backend.
- ProductInfo's variant chips may be static markup with one option visibly selected, or client state if you prefer — if they hold state, add "use client".

Commerce detail
- PriceBlock shows the current price prominently, an optional struck-through compare-at price beside it, and a discount badge only when a compare-at price is present. One stock or shipping reassurance line.
- Reviews opens with an average-rating summary and a count, then 3–4 reviews with author, star rating drawn as inline SVG, a date and a body that mentions the product.
- Specs is 5–8 label/value rows separated by hairlines in the theme border colour.

Getting back to the rest of the shop
- The Navbar's wordmark and its "Home" link both point at /, and its "Shop" link at /product is the current route.
- Above the Gallery, ProductInfo opens with a breadcrumb: <a href="/">the shop name</a> then a separator then the product name as plain text. That is how a visitor who arrived from the landing page gets back.
- The Footer is the same on this route as on the landing page: wordmark, one-line shop description, a "Shop" column carrying the same two route links in the same order, a "Support" column, and the same copyright line.
- Add to cart, Buy now, the quantity stepper and the variant chips are <button> elements. They never become anchors and they never navigate.

Out of scope for this page type
- No feature-benefit card grid, no testimonial marketing band, no closing conversion band. Those belong to the landing page.
- No subscription tiers or plan comparison anywhere in the shop. This route shows one product at one price, with variants and quantity — that is the whole pricing story.
- The Navbar carries the shop's two route links and the cart control, nothing else — no marketing anchors, no section links, no second button.`;

/** Full system prompt for a product-page generation. */
export function buildProductSystemPrompt(hasAttachments = false): string {
  return [buildBaseSystemPrompt("product", hasAttachments), "", PRODUCT_DIRECTION].join("\n");
}
