import { buildBaseSystemPrompt } from "./base";

/**
 * The landing-page system prompt. Deliberately a different file from the
 * product prompt: the required file list, the composition and the art direction
 * all differ, so switching page type has to produce a visibly different site
 * rather than the same page with sections renamed.
 */

const LANDING_DIRECTION = `## LANDING PAGE DIRECTION

This is a one-scroll marketing page. Its only job is to convince a stranger to buy.

Narrative
- The scroll is an argument: promise → why it is better → who already bought → last call. Each section answers the objection the one above it raised.
- Hero: one h1 of at most 9 words that names the product and the outcome, one sentence of subcopy carrying the concrete detail (what is in the box, who it is for, how fast it ships), a primary and a secondary CTA, and one wide image.
- Features are benefits, not specifications: "Ships in 48 hours from Rotterdam" beats "Logistics". Each card gets a short title and two lines of copy.
- Testimonials: 2–3 quotes with a named author, their role or city, and a round picsum avatar. The quotes mention the product by name.
- CTA: one closing band on the primary colour, one heading, one line of copy, exactly one action.

Layout and rhythm
- Alternate section backgrounds between the theme background and the theme secondary so the page breathes. Neighbouring sections never share the same tint.
- The CTA band uses the primary colour with text that keeps a strong contrast against it.
- Cards use the theme border colour for hairlines, not a shadow-heavy look, unless the brand feel genuinely calls for depth.

Anchors
- Features renders id="features", Testimonials renders id="testimonials".
- Those anchors are linked from the page's body, never from the Navbar. The Navbar is shared chrome (see THE SHOP above): the two route links and the cart control, nothing else.

Where the buying journey goes — this page's job ends at the product page
- Every link out of this page is a real <a> element with a real href. A CTA rendered as <button>, or as a <div> with an onClick, is broken: it looks clickable and goes nowhere. If it moves the visitor, it is an anchor.
- The Hero's PRIMARY CTA is <a href="/product">. It is the page's main conversion path, and its label says so: "Shop the range", "Buy the kit", whatever fits the brand. Style the anchor to look like a button if you want — inline-block, padding, rounded, the primary colour — but it stays an anchor. The secondary CTA may be an in-page anchor such as href="#features".
- The closing CTA band's single action is <a href="/product">.
- Nothing on this page links to a route that is not / or /product. A "Blog" or "About" link in the footer is a dead link, so word the footer's non-Shop columns as plain text or point them at the two real routes.

Out of scope for this page type
- This shop sells a product, not a subscription. No pricing tiers, no plan comparison, no "Basic / Pro / Enterprise", no per-month billing, no "choose your plan" band. Price and purchase live on the product page, and a tiered pricing block on a shop's landing page reads as a SaaS template rather than a store.
- No quantity stepper, no variant chips, no specification table, no single-product gallery, no cart contents anywhere in the body. Those belong to the product page. The header's cart control is the exception: it is the shop's chrome and it appears on this route too, with the same markup.
- No component needs client state. Do not add "use client" to any file unless you genuinely wrote a hook or an event handler.`;

/** Full system prompt for a landing-page generation. */
export function buildLandingSystemPrompt(hasAttachments = false): string {
  return [buildBaseSystemPrompt("landing", hasAttachments), "", LANDING_DIRECTION].join("\n");
}
