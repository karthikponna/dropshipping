import type { ComponentShell, PageFramework } from "@/lib/types";

/**
 * The product-page contract. Kept in a separate file from the landing
 * framework on purpose: page type is a hard constraint in the system prompt,
 * so the two prompts share no required-file list.
 */

export const PRODUCT_COMPONENTS: readonly ComponentShell[] = [
  {
    path: "components/Navbar.tsx",
    name: "Navbar",
    purpose: "Sticky shop bar: wordmark, the shop's two route links, cart control.",
    signature: "export default function Navbar()",
    requirements: [
      "Shop name as a text wordmark on the left, wrapped in <a href=\"/\">",
      "Exactly two nav links, in this order — Home at href=\"/\" and Shop at href=\"/product\" (aria-current=\"page\" here)",
      "No section links (#reviews, #specs) and no CTA button in the header — the sections belong to this route only, and this page's actions live in its body",
      "A single <button type=\"button\" aria-label=\"Cart\"> at the right end, cart glyph plus item count",
      "Sticky at the top with a hairline bottom border",
    ],
  },
  {
    path: "components/Gallery.tsx",
    name: "Gallery",
    purpose: "Product imagery: one main shot plus selectable thumbnails.",
    signature: "export default function Gallery()",
    requirements: [
      "One large main image and 3–4 thumbnails, all from picsum.photos",
      "Thumbnail selection is client state — start the file with \"use client\"",
      "Square or 4:5 aspect ratio held with Tailwind aspect utilities",
      "Descriptive alt text naming the product",
    ],
  },
  {
    path: "components/ProductInfo.tsx",
    name: "ProductInfo",
    purpose: "Breadcrumb back to the shop, title, rating, description and the variant pickers.",
    signature: "export default function ProductInfo()",
    requirements: [
      "A breadcrumb above the title: <a href=\"/\">shop name</a>, a separator, then the product name as plain text",
      "One h1 with the product name and a one-paragraph description",
      "A rating line with a review count",
      "At least one variant group (size, colour or scent) rendered as selectable chips",
      "3–5 short bullet highlights",
    ],
  },
  {
    path: "components/PriceBlock.tsx",
    name: "PriceBlock",
    purpose: "Price, any compare-at price, and the stock/shipping reassurance line.",
    signature: "export default function PriceBlock()",
    requirements: [
      "Current price prominent, optional struck-through compare-at price beside it",
      "A discount badge only when a compare-at price is shown",
      "One stock or shipping reassurance line",
      "Consistent currency formatting with the rest of the page",
    ],
  },
  {
    path: "components/AddToCart.tsx",
    name: "AddToCart",
    purpose: "Quantity stepper plus the primary purchase action.",
    signature: "export default function AddToCart()",
    requirements: [
      "Quantity stepper with client state — start the file with \"use client\"",
      "A full-width primary Add to cart button and a secondary Buy now",
      "A returns or guarantee microcopy line under the buttons",
      "Buttons never wired to a real backend; local state only",
    ],
  },
  {
    path: "components/Specs.tsx",
    name: "Specs",
    purpose: "Specification table of concrete product attributes.",
    signature: "export default function Specs()",
    requirements: [
      "5–8 label/value rows separated by hairlines",
      "Values are concrete — materials, dimensions, weight, care, origin",
      "Two-column layout on desktop, stacked on mobile",
    ],
  },
  {
    path: "components/Reviews.tsx",
    name: "Reviews",
    purpose: "Customer reviews with a rating summary.",
    signature: "export default function Reviews()",
    requirements: [
      "An average-rating summary with a distribution or count",
      "3–4 reviews, each with author, rating, date and body",
      "Round avatars from picsum.photos",
    ],
  },
  {
    path: "components/Footer.tsx",
    name: "Footer",
    purpose: "Shop footer with the route links, support columns and a legal line.",
    signature: "export default function Footer()",
    requirements: [
      "Wordmark plus a one-line shop description",
      "A column headed \"Shop\" carrying href=\"/\" then href=\"/product\"",
      "A second column headed \"Support\" listing shipping, returns and contact as plain text, not dead links",
      "Copyright line with the shop name",
    ],
  },
];

export const PRODUCT_REQUIRED_FILES: readonly string[] = [
  "app/page.tsx",
  ...PRODUCT_COMPONENTS.map((component) => component.path),
];

export const productFramework: PageFramework = {
  pageType: "product",
  label: "Product page",
  description:
    "A single-product detail page for a dropshipping shop: gallery, product info, price, purchase action, specs, reviews.",
  requiredFiles: PRODUCT_REQUIRED_FILES,
  entryFile: "app/page.tsx",
  composition: PRODUCT_COMPONENTS.map((component) => component.name),
  components: PRODUCT_COMPONENTS,
  promptGuidance: [
    "app/page.tsx imports every component from '@/components/<Name>' and renders them in the composition order, wrapped in a <main> element.",
    "Layout above the fold is a two-column split: Gallery on the left, then ProductInfo, PriceBlock and AddToCart stacked on the right. It collapses to one column below lg.",
    "Specs and Reviews sit full width below the split.",
    "Navigation away from this page points back at the shop: the wordmark, the Home link and the breadcrumb all use href=\"/\". The nav's Shop link still points at href=\"/product\" and marks itself as the current route. Every purchase control is a <button>.",
    "Invent one specific product with a real name, price and materials — never lorem ipsum and never the word 'placeholder'.",
    "All images use https://picsum.photos/seed/<kebab-slug>/<w>/<h> so they always resolve.",
    "Tailwind utility classes only. No CSS files, no styled-components, no UI library imports.",
  ],
};

export default productFramework;
