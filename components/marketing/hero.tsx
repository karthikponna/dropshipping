import { FRAMEWORKS } from "@/lib/framework";

import { SecondaryLink, SplitLink } from "./buttons";
import { MonoLabel } from "./eyebrow";
import { DotGrid } from "./frame";

/** Honest facts about the output, not invented traction numbers. */
const FACTS = [
  { value: String(Object.keys(FRAMEWORKS).length), caption: "Page types" },
  {
    value: `${FRAMEWORKS.landing.components.length}–${FRAMEWORKS.product.components.length}`,
    caption: "Components per page",
  },
  { value: ".zip", caption: "Export the whole tree" },
] as const;

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-sm-border-light">
      <DotGrid />

      {/* Entrance via @starting-style: pure CSS, so the content is already in
          its final state if the browser or the user opts out. The scope's
          reduced-motion rule collapses the duration. */}
      <div className="sm-container relative translate-y-0 pt-14 pb-16 text-center opacity-100 blur-[0px] transition-[opacity,transform,filter] delay-[60ms] duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)] starting:translate-y-[14px] starting:opacity-0 starting:blur-[14px] md:pt-20 md:pb-24">
        <div className="inline-flex h-8 items-center gap-3 border border-sm-border bg-white/80 pr-3 pl-1">
          <span className="inline-flex h-6 items-center gap-1.5 bg-sm-blue-tint px-2 font-sm-mono text-[10px] font-medium tracking-[0.16em] uppercase text-sm-blue">
            <span aria-hidden="true" className="h-[5px] w-[5px] bg-sm-blue" />
            New
          </span>
          <span className="font-sm-body text-[13.5px] font-medium tracking-[-0.005em] text-sm-text">
            Landing pages and product pages from one prompt
          </span>
        </div>

        <h1 className="mx-auto mt-8 max-w-[22ch] text-balance">
          Describe the shop. Get the storefront<span className="dot">.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-[620px] text-[16px]">
          Write what you sell in plain English, pick a landing page or a product page, and watch a
          full Next.js and Tailwind storefront get written file by file. Preview it live, refine it
          in the same thread, keep every version.
        </p>

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <SplitLink href="/signup" label="Start building" />
          <SecondaryLink href="#how-it-works">See how it works</SecondaryLink>
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-[520px] items-center gap-3 border border-sm-border-light bg-sm-paper px-3.5 py-2.5 text-left font-sm-mono text-[12.5px] text-sm-text-muted">
          <span aria-hidden="true" className="text-sm-blue">
            &gt;
          </span>
          <span className="truncate">minimalist ceramic mugs, warm neutrals, three tiers</span>
        </div>

        <div className="mt-14">
          <MonoLabel>What you walk away with</MonoLabel>
          <div className="mx-auto mt-4 grid w-full max-w-[720px] grid-cols-1 divide-y divide-sm-border-light border border-sm-border-light sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {FACTS.map((fact) => (
              <div key={fact.caption} className="px-5 py-4 text-center sm:text-left">
                <span className="block font-sm-heading text-[28px] leading-none font-medium tracking-[-0.03em] text-sm-text">
                  {fact.value}
                </span>
                <MonoLabel className="mt-2.5 block">{fact.caption}</MonoLabel>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
