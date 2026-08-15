import { Eyebrow, MonoLabel, SectionRail } from "./eyebrow";
import { CornerFrame, Crosshair } from "./frame";

const STEPS = [
  {
    eyebrow: "Describe",
    title: "Write the brief",
    body: "One box, plain English. What you sell, who buys it, the tone, the price points. No template gallery, no theme picker, no forms to fill in.",
    meta: "input · prose",
  },
  {
    eyebrow: "Generate",
    title: "Claude fills the contract",
    body: "Each page type has a fixed component list. The model writes every file in it — real copy for your product, a matching colour and font theme — and streams the files in as they are produced.",
    meta: "output · app/page.tsx + components",
  },
  {
    eyebrow: "Preview",
    title: "See it, then refine it",
    body: "The tree renders in a sandboxed preview at desktop, tablet and mobile widths. Ask for changes in the same thread; every pass is saved as a numbered version.",
    meta: "preview · sandboxed iframe",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="sm-container sm-section scroll-mt-[57px]">
      <SectionRail label="How it works" index={1} total={4} />

      <div className="mt-10 grid gap-6 md:grid-cols-[1fr_auto] md:items-end md:gap-10">
        <h2 className="max-w-[18ch]">
          Prompt in. Storefront out<span className="dot">.</span>
        </h2>
        <p className="max-w-[420px] text-[15px] md:text-right">
          There is no builder interface to learn. One prompt, one page type, one preview you can keep
          iterating on.
        </p>
      </div>

      <CornerFrame className="mt-10">
        {/* -1px pulls each cell's own hairline onto the frame edge, so the grid
            reads as interior dividers at every column count. */}
        <div className="relative -mt-px -ml-px grid md:grid-cols-3">
          <Crosshair className="top-0 left-1/3 hidden md:block" />
          <Crosshair className="top-0 left-2/3 hidden md:block" />
          <Crosshair className="top-full left-1/3 hidden md:block" />
          <Crosshair className="top-full left-2/3 hidden md:block" />

          {STEPS.map((step, index) => (
            <div
              key={step.eyebrow}
              className="flex flex-col gap-4 border-t border-l border-dashed border-sm-border-dashed p-7 md:p-8"
            >
              <Eyebrow index={index + 1}>{step.eyebrow}</Eyebrow>
              <h3>{step.title}</h3>
              <p className="text-[14.5px]">{step.body}</p>
              <MonoLabel className="mt-auto block pt-2">{step.meta}</MonoLabel>
            </div>
          ))}
        </div>
      </CornerFrame>
    </section>
  );
}
