"use client";

import { CheckIcon } from "@/components/dashboard/icons";
import type { GenerationStreamState } from "@/lib/ai/stream-client";
import { cx } from "@/lib/dashboard/format";
import type { GenerationPhase } from "@/lib/types";

import { FileIcon, StopIcon } from "./icons";

/**
 * The live turn: what the model is doing right now and which files have landed.
 *
 * It replaces the assistant bubble while a run is in flight, then the workspace
 * commits a plain message in its place — so a completed conversation carries no
 * spinners and re-reads the same on a reload.
 */

const PHASE_LABELS: Record<GenerationPhase, string> = {
  connecting: "Connecting to Claude",
  planning: "Designing the page",
  writing: "Writing components",
  repairing: "Filling in missing files",
  saving: "Saving this version",
  complete: "Finished",
};

export interface StreamActivityProps {
  stream: GenerationStreamState;
  /** Paths this run wrote, in arrival order. */
  touched: readonly string[];
  onCancel: () => void;
}

export function StreamActivity({ stream, touched, onCancel }: StreamActivityProps) {
  const pending = new Set(stream.pending);
  const written = touched.filter((path) => !pending.has(path)).length;

  return (
    <div className="rounded-amb-panel border border-amb-border bg-amb-muted/60 p-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amb-info"
        />
        <div className="min-w-0 flex-1">
          <p aria-live="polite" className="text-[13px] font-medium text-amb-foreground">
            {PHASE_LABELS[stream.phase]}
            {touched.length > 0 ? (
              <span className="ml-1.5 font-amb-mono text-[11px] font-normal text-amb-muted-foreground">
                [{written}/{touched.length}]
              </span>
            ) : null}
          </p>
          {stream.statusMessage ? (
            <p className="mt-0.5 text-[12px] leading-[1.5] text-amb-muted-foreground">
              {stream.statusMessage}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-amb-row border border-amb-border bg-amb-background px-2 text-[12px] font-medium text-amb-muted-foreground transition-colors hover:text-amb-foreground"
        >
          <StopIcon className="h-3 w-3" />
          Stop
        </button>
      </div>

      {touched.length > 0 ? (
        <ul className="mt-2.5 max-h-52 space-y-0.5 overflow-y-auto">
          {touched.map((path) => {
            const isPending = pending.has(path);
            return (
              <li
                className={cx(
                  "flex items-center gap-1.5 font-amb-mono text-[11px]",
                  isPending ? "text-amb-foreground" : "text-amb-muted-foreground",
                )}
                key={path}
              >
                {isPending ? (
                  <FileIcon className="h-3 w-3 animate-pulse" />
                ) : (
                  <CheckIcon className="h-3 w-3 text-amb-success" />
                )}
                <span className="truncate">{path}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
