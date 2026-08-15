import { Eyebrow, SectionRail } from "./eyebrow";
import { CornerFrame, Crosshair } from "./frame";

const FEATURES = [
  {
    eyebrow: "Contract",
    title: "Fixed component slots",
    body: "Every page type declares the files it needs. The prompt treats that list as a hard constraint, so a generation either completes the tree or gets repaired.",
  },
  {
    eyebrow: "Streaming",
    title: "Files as they are written",
    body: "The response streams one file at a time. You read the tree filling in rather than watching a progress bar.",
  },
  {
    eyebrow: "Preview",
    title: "Preview and code, one panel",
    body: "The result renders in a sandboxed iframe at desktop, tablet and mobile widths, with the generated source a tab away.",
  },
  {
    eyebrow: "Theme",
    title: "Colours and fonts per shop",
    body: "The model chooses a palette and a Google font pairing that fit the brief, then writes them to theme.json alongside the code.",
  },
  {
    eyebrow: "Versions",
    title: "History you can restore",
    body: "Each generation is stored as a numbered version on the project. Open the history drawer and roll back to any of them.",
  },
  {
    eyebrow: "Export",
    title: "The tree, unmodified",
    body: "Download a canonical Next.js project as a .zip. Nothing to port, no runtime of ours to keep around.",
  },
] as const;

export function Features() {
  return (
    <section id="features" className="sm-container sm-section scroll-mt-[57px]">
      <SectionRail label="What you get" index={3} total={4} />

      <div className="mt-10 grid gap-6 md:grid-cols-[1fr_auto] md:items-end md:gap-10">
        <h2 className="max-w-[20ch]">
          Built to be read, not trusted<span className="dot">.</span>
        </h2>
        <p className="max-w-[420px] text-[15px] md:text-right">
          The tree, the theme and every earlier version stay inspectable. Nothing is hidden behind a
          builder abstraction.
        </p>
      </div>

      <CornerFrame className="mt-10">
        {/* -1px pulls each cell's own hairline onto the frame edge, so the grid
            reads as interior dividers at every column count. */}
        <div className="relative -mt-px -ml-px grid sm:grid-cols-2 lg:grid-cols-3">
          <Crosshair className="top-0 left-1/2 hidden sm:block lg:hidden" />
          <Crosshair className="top-full left-1/2 hidden sm:block lg:hidden" />
          <Crosshair className="top-0 left-1/3 hidden lg:block" />
          <Crosshair className="top-full left-1/3 hidden lg:block" />
          <Crosshair className="top-0 left-2/3 hidden lg:block" />
          <Crosshair className="top-full left-2/3 hidden lg:block" />

          {FEATURES.map((feature, index) => (
            <div
              key={feature.eyebrow}
              className="flex flex-col gap-3.5 border-t border-l border-dashed border-sm-border-dashed p-7"
            >
              <Eyebrow index={index + 1}>{feature.eyebrow}</Eyebrow>
              <h4>{feature.title}</h4>
              <p className="text-[14.5px]">{feature.body}</p>
            </div>
          ))}
        </div>
      </CornerFrame>
    </section>
  );
}
