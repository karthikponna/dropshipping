"use client";

import { useEffect, useRef } from "react";

import { CloseIcon } from "@/components/dashboard/icons";
import { cx, formatRelativeTime } from "@/lib/dashboard/format";
import { PAGE_TYPE_LABELS, type PageType, type VersionSummary } from "@/lib/types";

import { AlertIcon, RestoreIcon } from "./icons";

/**
 * Version history for one page of the shop, newest first, with restore.
 *
 * Restoring does not generate anything: it repoints `projects.current_version_id`
 * at an older row through `PATCH /api/projects/[id]` and reloads that row's files
 * into the preview. The whole panel is mounted only while open, which also keeps
 * the relative timestamps out of the server-rendered HTML — they are the one
 * thing here that would not survive hydration.
 */

export interface VersionHistoryProps {
  open: boolean;
  onClose: () => void;
  /** Versions of the page on screen; the caller filters by page type. */
  versions: readonly VersionSummary[];
  /** Which page these versions belong to, for the header. */
  pageType: PageType;
  currentVersionId: string | null;
  /** Id of the version being restored right now, if any. */
  restoringId: string | null;
  error: string | null;
  onRestore: (versionId: string) => void;
}

export function VersionHistory({
  open,
  onClose,
  versions,
  pageType,
  currentVersionId,
  restoringId,
  error,
  onRestore,
}: VersionHistoryProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const busy = restoringId !== null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close version history"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
        type="button"
      />

      <div
        aria-label="Version history"
        aria-modal="true"
        className="relative flex h-full w-full max-w-[400px] flex-col border-l border-amb-border bg-amb-background shadow-amb-xl"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-amb-border px-4">
          <div>
            <h3 className="text-[15px]">
              {PAGE_TYPE_LABELS[pageType]} history
            </h3>
            <p className="text-[12px] text-amb-muted-foreground">
              {versions.length === 0
                ? "No versions saved yet."
                : "Every generation is kept. Restoring is reversible."}
            </p>
          </div>
          <button
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-amb-row text-amb-muted-foreground transition-colors hover:bg-amb-secondary hover:text-amb-foreground"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        {error ? (
          <p
            className="flex items-start gap-2 border-b border-amb-border bg-amb-destructive/[0.04] px-4 py-2.5 text-[12px] text-amb-destructive"
            role="alert"
          >
            <AlertIcon className="mt-px h-3.5 w-3.5" />
            {error}
          </p>
        ) : null}

        <ul className="min-h-0 flex-1 overflow-y-auto p-3">
          {versions.map((version) => {
            const isCurrent = version.id === currentVersionId;
            const isRestoring = version.id === restoringId;

            return (
              <li
                className={cx(
                  "mb-2 rounded-amb-panel border p-3",
                  isCurrent ? "border-amb-foreground/20 bg-amb-muted" : "border-amb-border",
                )}
                key={version.id}
              >
                <div className="flex items-center gap-2">
                  <span className="font-amb-mono text-[11px] text-amb-muted-foreground">
                    v{version.idx}
                  </span>
                  <span className="text-[12px] text-amb-muted-foreground">
                    {formatRelativeTime(version.created_at)}
                  </span>
                  {isCurrent ? (
                    <span className="ml-auto inline-flex h-5 items-center rounded-full bg-amb-primary px-2 text-[11px] font-medium text-amb-primary-foreground">
                      Current
                    </span>
                  ) : (
                    <button
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded-amb-row border border-amb-border px-2 text-[12px] font-medium text-amb-foreground transition-colors hover:bg-amb-secondary disabled:text-amb-muted-foreground"
                      disabled={busy}
                      onClick={() => onRestore(version.id)}
                      type="button"
                    >
                      <RestoreIcon className="h-3.5 w-3.5" />
                      {isRestoring ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 line-clamp-3 text-[13px] leading-[1.5] text-amb-foreground">
                  {version.prompt || "— no prompt recorded —"}
                </p>
              </li>
            );
          })}

          {versions.length === 0 ? (
            <li className="rounded-amb-panel border border-dashed border-amb-border p-4 text-[13px] text-amb-muted-foreground">
              Versions appear here as soon as the first generation finishes.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
