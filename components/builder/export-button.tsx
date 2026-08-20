"use client";

/**
 * The Export .zip control in the preview toolbar.
 *
 * The work happens entirely in the browser: `buildProjectZipBlob` pulls JSZip in
 * on demand, so the ~100KB library is only fetched by people who actually click
 * this, and the resulting blob is handed to a throwaway anchor. There is no
 * round trip to the server and nothing to clean up but the object URL.
 *
 * The label doubles as the status readout, and the button reserves its widest
 * label's worth of space so the toolbar never reflows mid-export. Screen readers
 * get the same transitions through a polite live region instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { buildProjectZipBlob, exportFileName } from "@/lib/export/project-zip";
import type { FileMap, PageType, Theme } from "@/lib/types";

export interface ExportButtonProps {
  /**
   * One canonical Next.js tree per page of the shop. A shop with both pages
   * exports as one app — landing at `/`, product at `/product` — so the download
   * is the whole site rather than whichever page happened to be open.
   */
  pages: Partial<Record<PageType, FileMap>>;
  theme?: Theme | null;
  name?: string;
  summary?: string;
  prompt?: string;
  /** Force-disable, e.g. while a generation is still streaming. */
  disabled?: boolean;
  className?: string;
}

type Phase = "idle" | "working" | "done" | "failed";

const LABELS: Record<Phase, string> = {
  idle: "Export .zip",
  working: "Preparing…",
  done: "Downloaded",
  failed: "Export failed",
};

const RESET_DELAY_MS = 2000;

const BUTTON_CLASS = [
  "inline-flex h-8 min-w-[124px] items-center justify-center gap-1.5",
  "rounded-amb-row border border-amb-border bg-amb-background px-2.5",
  "text-[13px] font-medium text-amb-foreground transition-colors",
  "hover:bg-amb-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-amb-background",
].join(" ");

export function ExportButton({
  pages,
  theme,
  name,
  summary,
  prompt,
  disabled = false,
  className,
}: ExportButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const resetTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const settle = useCallback((next: Phase, message: string | null): void => {
    if (!mounted.current) return;
    setPhase(next);
    setError(message);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      if (!mounted.current) return;
      setPhase("idle");
      setError(null);
    }, RESET_DELAY_MS);
  }, []);

  const pageCount = Object.values(pages).filter(
    (tree) => tree !== undefined && Object.keys(tree).length > 0,
  ).length;
  const isEmpty = pageCount === 0;
  const isDisabled = disabled || isEmpty || phase === "working";

  const download = useCallback(async (): Promise<void> => {
    setPhase("working");
    setError(null);

    try {
      const blob = await buildProjectZipBlob({ pages, theme, name, summary, prompt });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = exportFileName(name);
      anchor.href = url;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Revoking in the same tick cancels the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      settle("done", null);
    } catch (cause) {
      settle("failed", cause instanceof Error ? cause.message : "Could not build the zip.");
    }
  }, [name, pages, prompt, settle, summary, theme]);

  const label = LABELS[phase];
  const title =
    phase === "failed" && error !== null
      ? error
      : pageCount > 1
        ? "Download the whole shop as a zip — both pages, one Next.js app"
        : "Download this project as a zip";

  return (
    <>
      <button
        aria-busy={phase === "working"}
        className={className ? `${BUTTON_CLASS} ${className}` : BUTTON_CLASS}
        disabled={isDisabled}
        onClick={() => {
          void download();
        }}
        title={isEmpty ? "Nothing to export yet" : title}
        type="button"
      >
        <DownloadIcon />
        {label}
      </button>
      <span aria-live="polite" className="sr-only" role="status">
        {phase === "idle" ? "" : error !== null ? `${label}: ${error}` : label}
      </span>
    </>
  );
}

/** 16px stroke glyph, drawn to the same 1.5px rhythm as components/preview/icons.tsx. */
function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}
