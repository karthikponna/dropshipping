import Link from "next/link";

/* PLACEHOLDER — Wave 2 (marketing) replaces this with the full supermemory
   landing page: sticky header, hero with the split CTA button, corner-tick
   feature frames, mono eyebrows and [n/n] section counters. */
export default function MarketingHomePage() {
  return (
    <main className="sm-container sm-section">
      <p className="font-sm-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sm-blue">
        01 · Wave 1
      </p>
      <h1 className="mt-4 max-w-sm-prose">
        Describe a shop. Get the site<span className="dot">.</span>
      </h1>
      <p className="mt-6 max-w-sm-prose text-[16px]">
        Scaffold only — the marketing page lands in Wave 2.
      </p>
      <div className="mt-8 flex gap-3 font-sm-mono text-[10.5px] uppercase tracking-[0.18em]">
        <Link href="/login">Log in</Link>
        <span className="text-sm-text-dim">/</span>
        <Link href="/signup">Sign up</Link>
        <span className="text-sm-text-dim">/</span>
        <Link href="/dashboard">Dashboard</Link>
      </div>
    </main>
  );
}
