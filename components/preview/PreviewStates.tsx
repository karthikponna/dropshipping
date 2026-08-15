"use client";

import type { PageType } from "@/lib/types";

import { LayoutIcon } from "./icons";

const EMPTY_COPY: Record<PageType, string> = {
  landing: "Describe the shop you want and the landing page renders here as it is written.",
  product: "Describe the product you want and the product page renders here as it is written.",
};

export interface PreviewEmptyStateProps {
  /** Tailors the copy to the page type the user picked. */
  pageType?: PageType;
}

/** Nothing generated yet. */
export function PreviewEmptyState({ pageType }: PreviewEmptyStateProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-amb-muted p-6">
      <div className="max-w-xs text-center">
        <span className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-amb-row border border-amb-border bg-amb-background text-amb-muted-foreground shadow-amb-xs">
          <LayoutIcon />
        </span>
        <h4 className="text-[15px] font-medium tracking-[-0.01em] text-amb-foreground">
          No preview yet
        </h4>
        <p className="mt-1.5 text-[13px] leading-relaxed text-amb-muted-foreground">
          {pageType ? EMPTY_COPY[pageType] : EMPTY_COPY.landing}
        </p>
      </div>
    </div>
  );
}

/** Shown while the panel mounts, and while the first files stream in. */
export function PreviewLoadingState({ label = "Starting the preview" }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col gap-3 bg-amb-muted p-6">
      <div className="flex items-center gap-2 text-[13px] text-amb-muted-foreground">
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-amb-border border-t-amb-foreground"
        />
        {label}
      </div>
      <div className="flex-1 animate-pulse rounded-amb-panel border border-amb-border bg-amb-background" />
    </div>
  );
}
