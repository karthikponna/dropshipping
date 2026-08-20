import { AuthCanvas } from "./auth-canvas";
import { Eyebrow } from "./eyebrow";
import { CornerFrame } from "./frame";

/**
 * The panel beside the login card: a deep blue field of halftone dots that
 * lights up under the cursor, with the product's one-line claim over it.
 *
 * Hidden below `lg`. On a narrow screen it would push the form below the fold,
 * and it is decoration — there is nothing in here a user needs.
 */

const CLAIM = [
  { term: "Describe", detail: "One sentence about the shop you want to sell." },
  { term: "Watch", detail: "Sections land one file at a time, live." },
  { term: "Export", detail: "One Next.js app. Landing and product, one theme." },
] as const;

export function AuthShowcase() {
  return (
    <CornerFrame className="relative hidden min-h-[560px] flex-1 p-2.5 lg:block">
      <div className="relative h-full overflow-hidden bg-sm-ink">
        {/* The canvas sits under the copy and takes the pointer for the whole
            panel — the listener is on this element, not on the canvas. */}
        <AuthCanvas className="absolute inset-0 block h-full w-full" />

        {/* Holds the field back from the copy at the bottom without flattening
            the open half of the panel, where the dots do the work. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 block bg-gradient-to-t from-sm-ink via-sm-ink/75 via-35% to-transparent to-65%"
        />

        <div className="pointer-events-none relative flex h-full flex-col justify-between p-8 xl:p-10">
          <Eyebrow tone="onBlue" marker>
            Shops, written to order
          </Eyebrow>

          <div>
            <p className="max-w-[16ch] font-sm-heading text-[38px] leading-[1.06] tracking-[-0.02em] text-white xl:text-[44px]">
              Describe the shop<span className="text-white/55">.</span>
              <br />
              Read the code<span className="text-white/55">.</span>
            </p>

            <dl className="mt-9 flex flex-col gap-4 border-t border-white/20 pt-7">
              {CLAIM.map(({ term, detail }) => (
                <div key={term} className="flex gap-4">
                  <dt className="w-[74px] shrink-0 font-sm-mono text-[10.5px] leading-[1.6] font-medium tracking-[0.18em] text-white/60 uppercase">
                    {term}
                  </dt>
                  <dd className="font-sm-body text-[14px] leading-[1.6] text-white/85">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </CornerFrame>
  );
}
