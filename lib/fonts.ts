import { DM_Mono, DM_Sans, Geist, Space_Grotesk } from "next/font/google";

/**
 * Self-hosted via next/font so no runtime request to fonts.googleapis.com.
 * Each font exposes a CSS variable; the route-group layouts attach the
 * variables their design system needs, keeping the two type stacks apart.
 */

/** supermemory: headings, stat numbers, tier CTAs. */
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

/** supermemory: body, buttons, nav, lists. */
export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

/** supermemory: uppercase eyebrows, `[n/n]` counters, terminal strips. */
export const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-dm-mono",
});

/** amboras admin: the console's only typeface. */
export const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

/** Class list for the marketing/auth subtree wrapper. */
export const marketingFontVariables = [
  spaceGrotesk.variable,
  dmSans.variable,
  dmMono.variable,
].join(" ");

/** Class list for the dashboard subtree wrapper. */
export const dashboardFontVariables = geist.variable;
