"use client";

import { useState } from "react";

import { FRAMEWORKS } from "@/lib/framework";
import { PAGE_TYPES, type PageType } from "@/lib/types";

import { cx } from "./cx";
import { Eyebrow, MonoLabel, SectionRail } from "./eyebrow";
import { CornerFrame } from "./frame";

/** Copy that belongs to the marketing page, keyed off the real contracts. */
const DETAIL: Record<PageType, { bestFor: string; highlights: readonly string[] }> = {
  landing: {
    bestFor: "The shop itself. One scroll that pitches, proves and closes.",
    highlights: [
      "Hero pitch and benefit cards in a single scroll",
      "Proof section and a closing conversion band before the footer",
      "Every call to action links straight through to the product page",
    ],
  },
  product: {
    bestFor: "A single product. Everything a buyer needs on one page.",
    highlights: [
      "Gallery with a main shot and selectable thumbnails",
      "Variant chips, price with compare-at, and the purchase action",
      "Specification table and reviews below the two-column split",
    ],
  },
};

export function PageTypeSplit() {
  const [active, setActive] = useState<PageType>("landing");
  const framework = FRAMEWORKS[active];
  const detail = DETAIL[active];

  return (
    <section
      id="page-types"
      className="scroll-mt-[57px] border-y border-sm-border-light bg-sm-bg-alt"
    >
      <div className="sm-container sm-section">
        <SectionRail label="Page types" index={2} total={3} />

        <h2 className="mt-10 max-w-[20ch]">
          Two page types. Each one a contract<span className="dot">.</span>
        </h2>

        <div
          role="group"
          aria-label="Page type"
          className="mt-10 inline-flex border border-sm-border bg-white"
        >
          {PAGE_TYPES.map((pageType) => {
            const selected = pageType === active;
            return (
              <button
                key={pageType}
                type="button"
                aria-pressed={selected}
                onClick={() => setActive(pageType)}
                className={cx(
                  "inline-flex h-10 items-center px-4 font-sm-body text-[14px] font-medium tracking-[-0.005em] transition-colors duration-[180ms] ease-sm-out-strong first:border-r first:border-sm-border motion-reduce:transition-none",
                  selected
                    ? "bg-sm-blue text-white"
                    : "bg-white text-sm-text-muted hover:bg-sm-blue-tint hover:text-sm-blue",
                )}
              >
                {FRAMEWORKS[pageType].label}
              </button>
            );
          })}
        </div>

        <CornerFrame className="mt-6 bg-white">
          <div className="grid lg:grid-cols-2">
            <div className="flex flex-col gap-5 border-dashed border-sm-border-dashed p-7 md:p-9 lg:border-r">
              <Eyebrow marker>{framework.label}</Eyebrow>
              <h3 className="max-w-[24ch]">{detail.bestFor}</h3>
              <p className="text-[14.5px]">{framework.description}</p>

              <ul className="mt-1 flex flex-col gap-2.5">
                {detail.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-3 text-[14.5px] text-sm-text-muted">
                    <span aria-hidden="true" className="mt-[7px] h-[6px] w-[6px] shrink-0 bg-sm-blue" />
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-5 border-t border-dashed border-sm-border-dashed bg-sm-paper-blue p-7 md:p-9 lg:border-t-0">
              <MonoLabel>Required files</MonoLabel>
              <ul className="flex flex-col divide-y divide-sm-border-light border border-sm-border-light bg-white">
                {framework.requiredFiles.map((path) => (
                  <li
                    key={path}
                    className="flex items-center gap-3 px-3.5 py-2 font-sm-mono text-[12.5px] text-sm-text-muted"
                  >
                    <span aria-hidden="true" className="h-[5px] w-[5px] shrink-0 bg-sm-blue" />
                    <span className="truncate">{path}</span>
                  </li>
                ))}
              </ul>

              <div>
                <MonoLabel>Composition order</MonoLabel>
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-sm-mono text-[12px] text-sm-text-dim">
                  {framework.composition.map((name, index) => (
                    <span key={name} className="inline-flex items-center gap-2">
                      {index > 0 ? <span aria-hidden="true">→</span> : null}
                      <span className="text-sm-text-muted">{name}</span>
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </div>
        </CornerFrame>

        <p className="mt-5 max-w-[640px] font-sm-mono text-[12px] leading-relaxed text-sm-text-dim">
          Every generation is checked against the list above. A missing file triggers one targeted
          repair call, not a full regeneration.
        </p>
      </div>
    </section>
  );
}
