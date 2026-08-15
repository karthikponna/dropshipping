import { marketingFontVariables } from "@/lib/fonts";

/**
 * Marketing + auth subtree. `sm-scope` is the only place the
 * supermemory-design-system tokens exist — including its `border-radius: 0`
 * reset, which is scoped to this class so it cannot reach the dashboard.
 *
 * Utilities available here are namespaced `sm-*`: bg-sm-blue, text-sm-text,
 * font-sm-mono, max-w-sm-page. Helper classes: sm-container, sm-section, dot,
 * and sm-round (the radius escape hatch for avatars and status dots).
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`sm-scope ${marketingFontVariables} min-h-dvh`}>{children}</div>
  );
}
