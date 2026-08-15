/**
 * Fixture file trees for the adapter test script (`run-tests.mjs`).
 *
 * They imitate what Claude actually emits, including the things that go wrong:
 * a `"use client"` directive on a component, `next/image` and `next/link`,
 * `next/font/google`, an icon package the sandbox does not have, a generation
 * caught mid-stream, and a file that is outright broken.
 */

import type { FileMap } from "@/lib/types";

const LANDING_PAGE = `import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Pricing from "@/components/Pricing";
import Testimonials from "@/components/Testimonials";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

export default function Page() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Features />
      <Pricing />
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
        <Link href="#pricing" className="rounded bg-primary px-5 py-3 text-white">
          Shop the blend
        </Link>
        <Link href={{ pathname: "/about", hash: "story" }}>Our story</Link>
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

/** A complete landing generation, the happy path. */
export const landingFixture: FileMap = {
  "app/page.tsx": LANDING_PAGE,
  "components/Navbar.tsx": simpleSection("Navbar", "Morning Ritual"),
  "components/Hero.tsx": LANDING_HERO,
  "components/Features.tsx": simpleSection("Features", "Why this blend"),
  "components/Pricing.tsx": simpleSection("Pricing", "Pick your bag"),
  "components/Testimonials.tsx": simpleSection("Testimonials", "Loved by early risers"),
  "components/CTA.tsx": simpleSection("CTA", "Start tomorrow right"),
  "components/Footer.tsx": simpleSection("Footer", "Morning Ritual"),
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

/** A complete product generation with a client component and stray packages. */
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
  "components/Navbar.tsx": simpleSection("Navbar", "Copper Kettle"),
  "components/Gallery.tsx": simpleSection("Gallery", "Every angle"),
  "components/ProductInfo.tsx": simpleSection("ProductInfo", "The 1.2L pour-over kettle"),
  "components/PriceBlock.tsx": `export default function PriceBlock({ price }: { price: string }) {
  return <p className="text-2xl font-semibold">{price}</p>;
}
`,
  "components/AddToCart.tsx": ADD_TO_CART,
  "components/Specs.tsx": simpleSection("Specs", "Specifications"),
  "components/Reviews.tsx": simpleSection("Reviews", "What buyers say"),
  "components/Footer.tsx": simpleSection("Footer", "Copper Kettle"),
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
