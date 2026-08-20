import Link from "next/link";

import { SplitLink } from "./buttons";
import { Eyebrow, SectionRail } from "./eyebrow";
import { DotGrid } from "./frame";

const NEXT_STEPS = [
  "Create an account with Google, or an email and a password",
  "Describe the shop you want to sell",
  "Pick a landing page or a product page",
  "Watch the files land, then refine or export",
] as const;

export function ClosingCta() {
  return (
    <section className="sm-container sm-section">
      <SectionRail label="Start" index={3} total={3} />

      <div className="relative isolate mt-10 overflow-hidden bg-sm-blue text-white">
        <DotGrid tone="white" />

        <div className="relative grid gap-10 p-8 md:p-14 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <Eyebrow tone="onBlue" marker>
              Get started
            </Eyebrow>
            <h2 className="mt-6 max-w-[20ch] text-white">Describe the shop. Read the code.</h2>
            <p className="mt-5 max-w-[440px] text-[15px] text-white/75">
              Sign in with Google or an email address. Your first storefront takes one sentence.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <SplitLink href="/signup" label="Create an account" tone="white" />
              <Link
                href="/login"
                className="font-sm-body text-[14.5px] font-medium text-white underline decoration-white/40 underline-offset-4 transition-colors duration-[180ms] ease-sm-out-strong hover:decoration-white motion-reduce:transition-none"
              >
                Log in
              </Link>
            </div>
          </div>

          <ol className="border border-white/[0.22]">
            {NEXT_STEPS.map((step, index) => (
              <li
                key={step}
                className="flex gap-4 border-b border-white/[0.22] px-5 py-4 last:border-b-0"
              >
                <span className="font-sm-mono text-[10.5px] font-medium tracking-[0.18em] text-white/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-sm-body text-[14.5px] text-white">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
