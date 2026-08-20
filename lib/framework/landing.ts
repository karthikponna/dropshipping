import type { ComponentShell, PageFramework } from "@/lib/types";

/**
 * The landing-page contract. These slots are a hard constraint in the system
 * prompt, not a suggestion: the parser checks that every required file arrived
 * and triggers a targeted repair call for anything missing.
 */

export const LANDING_COMPONENTS: readonly ComponentShell[] = [
  {
    path: "components/Navbar.tsx",
    name: "Navbar",
    purpose: "Sticky shop bar: wordmark, the shop's two route links, cart control.",
    signature: "export default function Navbar()",
    requirements: [
      "Shop name as a text wordmark on the left, wrapped in <a href=\"/\">",
      "Exactly two nav links, in this order — Home at href=\"/\" (aria-current=\"page\" here) and Shop at href=\"/product\"",
      "No section links (#features, #testimonials) and no CTA button in the header — the sections belong to this route only, and this page's CTAs live in its body",
      "A single <button type=\"button\" aria-label=\"Cart\"> at the right end, cart glyph plus item count",
      "Sticky at the top with a hairline bottom border",
    ],
  },
  {
    path: "components/Hero.tsx",
    name: "Hero",
    purpose: "Above-the-fold pitch: headline, subcopy, two CTAs and one image.",
    signature: "export default function Hero()",
    requirements: [
      "One h1 headline of at most 9 words that names the actual product",
      "A one-sentence subheadline",
      "A primary CTA written as <a href=\"/product\"> — an anchor, never a <button> — and a secondary one that may be an in-page anchor",
      "One hero image from picsum.photos with descriptive alt text",
    ],
  },
  {
    path: "components/Features.tsx",
    name: "Features",
    purpose: "Three to six benefit cards with an id=\"features\" anchor.",
    signature: "export default function Features()",
    requirements: [
      "Section heading plus a one-line intro",
      "3–6 cards, each with a short title and two lines of copy",
      "An inline SVG glyph per card — no icon library imports",
      "Responsive grid: one column on mobile, three from md up",
    ],
  },
  {
    path: "components/Testimonials.tsx",
    name: "Testimonials",
    purpose: "Social proof quotes with an id=\"testimonials\" anchor.",
    signature: "export default function Testimonials()",
    requirements: [
      "2–3 quotes with an author name and role",
      "An avatar per quote from picsum.photos, rendered round",
      "No star ratings unless the shop category makes them obvious",
    ],
  },
  {
    path: "components/CTA.tsx",
    name: "CTA",
    purpose: "Closing conversion band before the footer.",
    signature: "export default function CTA()",
    requirements: [
      "One short heading and one line of supporting copy",
      "A single primary action written as <a href=\"/product\"> — an anchor, never a <button>",
      "A contrasting background using the theme's primary colour",
    ],
  },
  {
    path: "components/Footer.tsx",
    name: "Footer",
    purpose: "Shop footer with the route links, supporting columns and a legal line.",
    signature: "export default function Footer()",
    requirements: [
      "Wordmark plus a one-line shop description",
      "A column headed \"Shop\" carrying href=\"/\" then href=\"/product\"",
      "A second column headed \"Support\" listing shipping, returns and contact as plain text, not dead links",
      "Copyright line with the shop name",
    ],
  },
];

export const LANDING_REQUIRED_FILES: readonly string[] = [
  "app/page.tsx",
  ...LANDING_COMPONENTS.map((component) => component.path),
];

export const landingFramework: PageFramework = {
  pageType: "landing",
  label: "Landing page",
  description:
    "A single-scroll marketing page for a dropshipping shop: pitch, benefits, proof, closing CTA.",
  requiredFiles: LANDING_REQUIRED_FILES,
  entryFile: "app/page.tsx",
  composition: LANDING_COMPONENTS.map((component) => component.name),
  components: LANDING_COMPONENTS,
  promptGuidance: [
    "app/page.tsx imports every component from '@/components/<Name>' and renders them in the composition order, wrapped in a <main> element.",
    "Every primary call to action on this page — the Hero's primary CTA and the closing CTA band — is an <a href=\"/product\"> element. Not a <button>, not a <div> with an onClick: the shop is browsed by following links, and a button goes nowhere.",
    "This is a shop selling a product, not a subscription service. No pricing tiers, no plan comparison table, no 'per month'. Price belongs on the product page.",
    "Write copy for the specific product the user described — never lorem ipsum and never the word 'placeholder'.",
    "Section rhythm: generous vertical padding, a constrained content column, and alternating background tints between neighbouring sections.",
    "All images use https://picsum.photos/seed/<kebab-slug>/<w>/<h> so they always resolve.",
    "Tailwind utility classes only. No CSS files, no styled-components, no UI library imports.",
  ],
};

export default landingFramework;
