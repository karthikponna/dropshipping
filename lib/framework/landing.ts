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
    purpose: "Sticky top bar with the shop wordmark, section links and one CTA.",
    signature: "export default function Navbar()",
    requirements: [
      "Shop name as a text wordmark on the left",
      "3–4 anchor links pointing at the sections below (#features, #pricing, #testimonials)",
      "One primary CTA button on the right",
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
      "Primary and secondary CTA buttons",
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
    path: "components/Pricing.tsx",
    name: "Pricing",
    purpose: "Two or three purchase tiers with an id=\"pricing\" anchor.",
    signature: "export default function Pricing()",
    requirements: [
      "2–3 tiers with a name, price, short description and 3–5 feature bullets",
      "One tier visually marked as recommended",
      "A CTA button on every tier",
      "Prices in a single currency, formatted consistently",
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
      "A single primary action — button or email capture, not both",
      "A contrasting background using the theme's primary colour",
    ],
  },
  {
    path: "components/Footer.tsx",
    name: "Footer",
    purpose: "Site footer with link columns and legal line.",
    signature: "export default function Footer()",
    requirements: [
      "Wordmark plus a one-line description",
      "2–3 link columns with 3–4 plausible links each",
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
    "A single-scroll marketing page for a dropshipping shop: pitch, benefits, pricing, proof, closing CTA.",
  requiredFiles: LANDING_REQUIRED_FILES,
  entryFile: "app/page.tsx",
  composition: LANDING_COMPONENTS.map((component) => component.name),
  components: LANDING_COMPONENTS,
  promptGuidance: [
    "app/page.tsx imports every component from '@/components/<Name>' and renders them in the composition order, wrapped in a <main> element.",
    "Write copy for the specific product the user described — never lorem ipsum and never the word 'placeholder'.",
    "Section rhythm: generous vertical padding, a constrained content column, and alternating background tints between neighbouring sections.",
    "All images use https://picsum.photos/seed/<kebab-slug>/<w>/<h> so they always resolve.",
    "Tailwind utility classes only. No CSS files, no styled-components, no UI library imports.",
  ],
};

export default landingFramework;
