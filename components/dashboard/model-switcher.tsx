"use client";

import { useId, useState } from "react";

import type { ModelChoice } from "@/lib/ai/model";
import { cx } from "@/lib/dashboard/format";
import { useDismiss } from "@/lib/dashboard/use-dismiss";

import { CheckIcon, ChevronDownIcon, SparkleIcon } from "./icons";

/**
 * Picks the Anthropic model the next generation runs on.
 *
 * It sits in the composer rather than a header because it belongs to the act of
 * sending — the same place the user decides what to say and what to attach. Both
 * composers show it: the dock, where the first generation of a shop is ordered,
 * and the builder rail, where every refinement after that is.
 *
 * The label drops the "Claude " prefix: every option has it, so the only thing
 * it adds at this size is four characters of noise between the icon and the
 * word that actually distinguishes one row from the next. The menu spells the
 * full name out.
 */

/** "Claude Sonnet 5" → "Sonnet 5". */
function shortLabel(label: string): string {
  return label.replace(/^Claude\s+/i, "");
}

export interface ModelSwitcherProps {
  models: readonly ModelChoice[];
  selected: string;
  onChange: (id: string) => void;
  /** Locked while a run is in flight — the model is fixed once the call is open. */
  disabled?: boolean;
  /**
   * Which way the menu opens. The rail's composer sits at the bottom of the
   * viewport, where a menu dropping down would land off-screen; the dock sits
   * mid-page with room below.
   */
  placement?: "up" | "down";
}

export function ModelSwitcher({
  models,
  selected,
  onChange,
  disabled = false,
  placement = "up",
}: ModelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const menuId = useId();

  // A stored choice can outlive the catalogue it came from — a key that loses
  // access, or a snapshot Anthropic retires. Naming the id is more use than
  // showing nothing, and the menu still offers everything that does work.
  const active = models.find((model) => model.id === selected);
  const label = active ? shortLabel(active.label) : selected;

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Model: ${active?.label ?? selected}. Change model`}
        {...(open ? { "aria-controls": menuId } : {})}
        className={cx(
          "inline-flex h-6 max-w-[190px] items-center gap-1 rounded-full px-1.5 text-[11.5px] font-medium transition-colors",
          disabled
            ? "cursor-not-allowed text-amb-muted-foreground/60"
            : open
              ? "bg-amb-secondary text-amb-foreground"
              : "text-amb-muted-foreground hover:bg-amb-secondary hover:text-amb-foreground",
        )}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <SparkleIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDownIcon
          className={cx("h-3 w-3 shrink-0 transition-transform", open ? "rotate-180" : "")}
        />
      </button>

      {open ? (
        <div
          className={cx(
            "absolute left-0 z-30 max-h-64 w-60 overflow-y-auto rounded-amb-panel border border-amb-border bg-amb-background p-1 shadow-amb-md",
            placement === "up" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
          )}
          id={menuId}
          role="menu"
        >
          {models.map((model) => {
            const isActive = model.id === selected;

            return (
              <button
                aria-checked={isActive}
                className={cx(
                  "flex w-full items-center gap-2 rounded-amb-row px-2 py-1.5 text-left transition-colors",
                  isActive ? "bg-amb-secondary" : "hover:bg-amb-secondary",
                )}
                key={model.id}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onChange(model.id);
                }}
                role="menuitemradio"
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-amb-foreground">
                    {model.label}
                  </span>
                  <span className="mt-0.5 block truncate font-amb-mono text-[10.5px] text-amb-muted-foreground">
                    {model.id}
                  </span>
                </span>
                {isActive ? (
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-amb-muted-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
