/**
 * Fixture file trees for the adapter test script (`run-tests.mjs`).
 *
 * They imitate what Claude actually emits, including the things that go wrong:
 * a `"use client"` directive on a component, `next/image` and `next/link`,
 * `next/font/google`, an icon package the sandbox does not have, a generation
 * caught mid-stream, and a file that is outright broken.
 *
 * The landing and product fixtures are also the two pages of one shop, wired to
 * each other the way the framework's chrome contract requires. That is what
 * `/dashboard/builder-harness` renders, so the route switcher and cross-page
 * navigation can be exercised in a browser with no credentials at all.
 */

import { PAGE_ROUTES } from "@/lib/framework/routes";
import type { FileMap, PageType } from "@/lib/types";

/**
 * The shop's chrome, written the way the prompt now demands it: the same links
 * with the same wording on both routes, only the current one marked.
 */
function chromeNavbar(shop: string, current: PageType): string {
  const link = (route: PageType, label: string): string => {
    const here = route === current;
    const attributes = [
      ...(here ? ['aria-current="page"'] : []),
      `className="${here ? "font-semibold underline" : "font-normal text-neutral-600"}"`,
      `href="${PAGE_ROUTES[route]}"`,
    ].join(" ");
    return `        <a ${attributes}>${label}</a>`;
  };

  return `export default function Navbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-black/10 bg-white/90 px-6 py-4 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 text-sm">
        <a className="mr-auto text-base font-semibold tracking-tight" href="${PAGE_ROUTES.landing}">
          ${shop}
        </a>
${link("landing", "Home")}
${link("product", "Shop")}
        <button type="button" aria-label="Cart" className="rounded px-2 py-1.5">
          Cart (0)
        </button>
      </nav>
    </header>
  );
}
`;
}

function chromeFooter(shop: string): string {
  return `export default function Footer() {
  return (
    <footer className="border-t border-black/10 px-6 py-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:justify-between">
        <p className="text-base font-semibold tracking-tight">${shop}</p>
        <div className="text-sm">
          <p className="mb-2 font-medium">Shop</p>
          <ul className="space-y-1 text-neutral-600">
            <li>
              <a href="${PAGE_ROUTES.landing}">Home</a>
            </li>
            <li>
              <a href="${PAGE_ROUTES.product}">Shop</a>
            </li>
          </ul>
        </div>
        <div className="text-sm text-neutral-600">
          <p className="mb-2 font-medium text-neutral-900">Support</p>
          <p>Ships in 48 hours</p>
          <p>30-day returns</p>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-xs text-neutral-500">
        © ${shop}. All rights reserved.
      </p>
    </footer>
  );
}
`;
}

const LANDING_PAGE = `import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Testimonials from "@/components/Testimonials";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

export default function Page() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Features />
      <Testimonials />
      <CTA />
      <Footer />
    </main>
  );
}
`;

const LANDING_HERO = `"use client";

import Image from "next/image";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";

const display = Playfair_Display({ subsets: ["latin"], weight: ["600"] });

export default function Hero() {
  return (
    <section className="px-6 py-24">
      <h1 className={display.className}>Brew better mornings</h1>
      <p>A slow-steeped blend for people who take the first hour seriously.</p>
      <div className="flex gap-3">
        <Link href="/product" className="rounded bg-primary px-5 py-3 text-white">
          Shop the range
        </Link>
        <Link href={{ pathname: "/product", hash: "specs" }}>See the specs</Link>
        <a href="#features">Why this blend</a>
      </div>
      <Image
        src="https://picsum.photos/seed/morning-ritual/1200/800"
        alt="A ceramic pour-over set on a linen cloth"
        width={1200}
        height={800}
        priority
        sizes="(max-width: 768px) 100vw, 1200px"
      />
      <div className="relative h-64">
        <Image src="https://picsum.photos/seed/beans/800/600" alt="Roasted beans" fill />
      </div>
    </section>
  );
}
`;

function simpleSection(name: string, heading: string): string {
  return `export default function ${name}() {
  return (
    <section id="${name.toLowerCase()}" className="px-6 py-20">
      <h2 className="text-3xl font-semibold">${heading}</h2>
      <p className="mt-3 text-neutral-600">Copy for the ${heading.toLowerCase()} section.</p>
    </section>
  );
}
`;
}

const THEME_JSON = `{
  "colors": { "primary": "#C8A24A", "background": "#FFFDF8", "foreground": "#171310" },
  "fonts": { "heading": "Playfair Display", "body": "Inter" },
  "radius": "0.75rem"
}
`;

const LANDING_CTA = `export default function CTA() {
  return (
    <section className="bg-neutral-900 px-6 py-20 text-center text-white">
      <h2 className="text-3xl font-semibold">Start tomorrow right</h2>
      <p className="mt-3 text-white/70">One bag, ground to your brewer, at your door in 48 hours.</p>
      <a
        className="mt-6 inline-block rounded bg-white px-6 py-3 font-medium text-neutral-900"
        href="/product"
      >
        Shop the range
      </a>
    </section>
  );
}
`;

/** A complete landing generation, the happy path — and route `/` of the shop. */
export const landingFixture: FileMap = {
  "app/page.tsx": LANDING_PAGE,
  "components/Navbar.tsx": chromeNavbar("Morning Ritual", "landing"),
  "components/Hero.tsx": LANDING_HERO,
  "components/Features.tsx": simpleSection("Features", "Why this blend"),
  "components/Testimonials.tsx": simpleSection("Testimonials", "Loved by early risers"),
  "components/CTA.tsx": LANDING_CTA,
  "components/Footer.tsx": chromeFooter("Morning Ritual"),
  "theme.json": THEME_JSON,
};

const PRODUCT_PAGE = `import Navbar from "@/components/Navbar";
import Gallery from "@/components/Gallery";
import ProductInfo from "@/components/ProductInfo";
import PriceBlock from "@/components/PriceBlock";
import AddToCart from "@/components/AddToCart";
import Specs from "@/components/Specs";
import Reviews from "@/components/Reviews";
import Footer from "@/components/Footer";
import { formatPrice } from "@/lib/format";

export default function Page() {
  return (
    <main>
      <Navbar />
      <Gallery />
      <ProductInfo />
      <PriceBlock price={formatPrice(4200)} />
      <AddToCart />
      <Specs />
      <Reviews />
      <Footer />
    </main>
  );
}
`;

const ADD_TO_CART = `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Check } from "lucide-react";
import clsx from "clsx";

export default function AddToCart() {
  const [added, setAdded] = useState(false);
  const router = useRouter();

  return (
    <button
      type="button"
      className={clsx("flex items-center gap-2 rounded px-5 py-3", added && "opacity-70")}
      onClick={() => {
        setAdded(true);
        router.refresh();
      }}
    >
      {added ? <Check /> : <ShoppingCart />}
      {added ? "Added to cart" : "Add to cart"}
    </button>
  );
}
`;

const PRODUCT_INFO = `export default function ProductInfo() {
  return (
    <section className="px-6 py-10">
      <nav className="mb-4 text-sm text-neutral-500">
        <a className="underline" href="/">
          Morning Ritual
        </a>
        <span className="mx-2">/</span>
        <span>1.2L Copper Pour-Over Kettle</span>
      </nav>
      <h1 className="text-4xl font-semibold tracking-tight">1.2L Copper Pour-Over Kettle</h1>
      <p className="mt-3 max-w-prose text-neutral-600">
        A gooseneck spout that pours at the rate you actually want, in hammered copper that
        holds heat for the whole brew.
      </p>
    </section>
  );
}
`;

/**
 * A complete product generation with a client component and stray packages —
 * and route `/product` of the same shop as `landingFixture`.
 */
export const productFixture: FileMap = {
  "app/page.tsx": PRODUCT_PAGE,
  "app/layout.tsx": `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Copper Kettle" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  "components/Navbar.tsx": chromeNavbar("Morning Ritual", "product"),
  "components/Gallery.tsx": simpleSection("Gallery", "Every angle"),
  "components/ProductInfo.tsx": PRODUCT_INFO,
  "components/PriceBlock.tsx": `export default function PriceBlock({ price }: { price: string }) {
  return <p className="text-2xl font-semibold">{price}</p>;
}
`,
  "components/AddToCart.tsx": ADD_TO_CART,
  "components/Specs.tsx": simpleSection("Specs", "Specifications"),
  "components/Reviews.tsx": simpleSection("Reviews", "What buyers say"),
  "components/Footer.tsx": chromeFooter("Morning Ritual"),
  "lib/format.ts": `export function formatPrice(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}
`,
  "theme.json": `{"colors":{"primary":"#B4532A"},"fonts":{"heading":"Fraunces","body":"Work Sans"}}`,
};

/** Mid-stream: the page has landed, most components have not, one is truncated. */
export const midStreamFixture: FileMap = {
  "app/page.tsx": LANDING_PAGE,
  "components/Navbar.tsx": simpleSection("Navbar", "Morning Ritual"),
  "components/Hero.tsx": `import Image from "next/image";

export default function Hero() {
  return (
    <section className="px-6 py-24">
      <h1 className="text-5xl font-semibold">Brew better mor`,
  "theme.json": `{"colors":{"primary":"#C8A2`,
};

/** Deliberately hostile input: broken syntax, bad keys, non-string values. */
export const brokenFixture = {
  "app/page.tsx": `export default function Page() { return ( <main> <Hero`,
  "components/Hero.tsx": "))))} <<<< not typescript at all `unterminated",
  "": "orphan entry with an empty path",
  "/components//Weird.tsx": `export default function Weird() { return <div />; }`,
  "components/Nested/../Odd.tsx": `export default function Odd() { return <div />; }`,
  "theme.json": "{{{not json",
  "components/Numeric.tsx": 42,
  "components/Nullish.tsx": null,
} as unknown as FileMap;

/** Only components, no page: the entry has to be synthesised. */
export const noEntryFixture: FileMap = {
  "components/Hero.tsx": simpleSection("Hero", "Almost there"),
  "components/Footer.tsx": simpleSection("Footer", "Almost there"),
};

export const fixtures: ReadonlyArray<{ name: string; files: FileMap }> = [
  { name: "landing (complete)", files: landingFixture },
  { name: "product (complete)", files: productFixture },
  { name: "mid-stream (partial)", files: midStreamFixture },
  { name: "broken input", files: brokenFixture },
  { name: "components only, no entry", files: noEntryFixture },
];
