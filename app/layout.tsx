import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DropShipping — describe a shop, get a site",
    template: "%s · DropShipping",
  },
  description:
    "Describe your shop, pick a landing or product page, and watch a full Next.js + Tailwind site get written live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The root layout intentionally applies neither design system. Tokens and
 * fonts are attached by the route-group layouts — app/(marketing)/layout.tsx
 * (supermemory) and app/(dashboard)/layout.tsx (amboras admin) — so the two
 * systems can never overlap on the same element.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
