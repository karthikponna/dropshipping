"use client";

import { PAGE_ROUTES } from "@/lib/framework/routes";
import { PAGE_TYPE_LABELS, type PageType } from "@/lib/types";

import { LayoutIcon } from "./icons";

const EMPTY_COPY: Record<PageType, string> = {
  landing: "Describe the shop you want and the landing page renders here as it is written.",
  product: "Describe the product you want and the product page renders here as it is written.",
};

export interface PreviewEmptyStateProps {
  /** Tailors the copy to the page type the user picked. */
  pageType?: PageType;
  /**
   * Present when this is a route of a shop that already exists elsewhere — the
   * slot is real and unbuilt, rather than the project being empty.
   */
  onBuild?: () => void;
}

/** Nothing generated yet, for this page or for the whole project. */
export function PreviewEmptyState({ pageType, onBuild }: PreviewEmptyStateProps) {
  const route = pageType ?? "landing";

  return (
    <div className="flex h-full w-full items-center justify-center bg-amb-muted p-6">
      <div className="max-w-xs text-center">
        <span className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-amb-row border border-amb-border bg-amb-background text-amb-muted-foreground shadow-amb-xs">
          <LayoutIcon />
        </span>
        <h4 className="text-[15px] font-medium tracking-[-0.01em] text-amb-foreground">
          {onBuild ? (
            <>
              <span className="font-amb-mono">{PAGE_ROUTES[route]}</span> is empty
            </>
          ) : (
            "No preview yet"
          )}
        </h4>
        <p className="mt-1.5 text-[13px] leading-relaxed text-amb-muted-foreground">
          {onBuild
            ? `This route is part of the shop, and the other pages already link to it — it just has no page yet. Building it reuses the shop's palette, type and chrome.`
            : EMPTY_COPY[route]}
        </p>
        {onBuild ? (
          <button
            className="mt-3.5 inline-flex h-8 items-center rounded-amb-row bg-amb-primary px-3 text-[13px] font-medium text-amb-primary-foreground transition-opacity hover:opacity-90"
            onClick={onBuild}
            type="button"
          >
            Build the {PAGE_TYPE_LABELS[route].toLowerCase()}
          </button>
        ) : null}
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
