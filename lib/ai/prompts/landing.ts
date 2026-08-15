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
- The scroll is an argument: promise → why it is better → what it costs → who already bought → last call. Each section answers the objection the one above it raised.
- Hero: one h1 of at most 9 words that names the product and the outcome, one sentence of subcopy carrying the concrete detail (what is in the box, who it is for, how fast it ships), a primary and a secondary CTA, and one wide image.
- Features are benefits, not specifications: "Ships in 48 hours from Rotterdam" beats "Logistics". Each card gets a short title and two lines of copy.
- Pricing: 2–3 tiers that read like real bundles for this product, one marked recommended with a visible ring or badge, every tier with its own CTA.
- Testimonials: 2–3 quotes with a named author, their role or city, and a round picsum avatar. The quotes mention the product by name.
- CTA: one closing band on the primary colour, one heading, one line of copy, exactly one action.

Layout and rhythm
- Alternate section backgrounds between the theme background and the theme secondary so the page breathes. Neighbouring sections never share the same tint.
- The CTA band uses the primary colour with text that keeps a strong contrast against it.
- Cards use the theme border colour for hairlines, not a shadow-heavy look, unless the brand feel genuinely calls for depth.

Anchors
- Features renders id="features", Pricing renders id="pricing", Testimonials renders id="testimonials".
- The Navbar links point at those exact anchors with href="#features" and friends, plus one primary CTA button on the right.

Out of scope for this page type
- No cart, no quantity stepper, no variant chips, no specification table, no single-product gallery. Those belong to the product page.
- No component needs client state. Do not add "use client" to any file unless you genuinely wrote a hook or an event handler.`;

/** Full system prompt for a landing-page generation. */
export function buildLandingSystemPrompt(): string {
  return [buildBaseSystemPrompt("landing"), "", LANDING_DIRECTION].join("\n");
}
