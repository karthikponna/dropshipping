import { SecondaryLink, SplitLink } from "./buttons";
import { DotGrid } from "./frame";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-sm-border-light">
      <DotGrid />

      {/* Entrance via @starting-style: pure CSS, so the content is already in
          its final state if the browser or the user opts out. The scope's
          reduced-motion rule collapses the duration. */}
      <div className="sm-container relative translate-y-0 pt-20 pb-20 text-center opacity-100 blur-[0px] transition-[opacity,transform,filter] delay-[60ms] duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)] starting:translate-y-[14px] starting:opacity-0 starting:blur-[14px] md:pt-28 md:pb-28">
        <h1 className="mx-auto max-w-[22ch] text-balance">
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
      </div>
    </section>
  );
}
