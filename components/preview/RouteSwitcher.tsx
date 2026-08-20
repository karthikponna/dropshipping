"use client";

import { useId, useState } from "react";

import { PAGE_ROUTES, SITE_ROUTES } from "@/lib/framework/routes";
import { cx } from "@/lib/dashboard/format";
import { useDismiss } from "@/lib/dashboard/use-dismiss";
import { PAGE_TYPE_LABELS, type PageType } from "@/lib/types";

import { CheckIcon, ChevronDownIcon, LayoutIcon, TagIcon } from "./icons";

/**
 * Which route of the shop the preview is rendering.
 *
 * Distinct from the chat rail's page switcher, which moves the *generation
 * target*. This one moves the *viewport*, and the difference is the point: a
 * cross-page link inside the preview lands here, so following one does not
 * silently re-aim the composer at the page you were only looking at.
 *
 * Every route of the shop is listed whether or not it has been built. An
 * unbuilt route is the affordance that matters — it is how the user finds out
 * the product page is a real slot in their shop rather than something they have
 * to know to ask for — so it stays selectable and offers to build itself.
 */

const ICONS: Record<PageType, (props: { className?: string }) => React.ReactElement> = {
  landing: LayoutIcon,
  product: TagIcon,
};

export interface RouteSwitcherProps {
  /** The route on screen. */
  active: PageType;
  /** Routes with at least one generated version. */
  built: readonly PageType[];
  /** The route a run is writing right now, if any. */
  generating?: PageType | null;
  onChange: (pageType: PageType) => void;
  /** Selecting a route with nothing behind it yet. Falls back to `onChange`. */
  onBuild?: (pageType: PageType) => void;
}

export function RouteSwitcher({
  active,
  built,
  generating,
  onChange,
  onBuild,
}: RouteSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const menuId = useId();

  const ActiveIcon = ICONS[active];

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Route: ${PAGE_ROUTES[active]}. Switch route`}
        {...(open ? { "aria-controls": menuId } : {})}
        className={cx(
          "inline-flex h-7 max-w-[190px] items-center gap-1.5 rounded-full border border-amb-border bg-amb-muted pl-2.5 pr-1.5 text-[12px] font-medium transition-colors",
          open
            ? "bg-amb-secondary text-amb-foreground"
            : "text-amb-foreground hover:bg-amb-secondary",
        )}
        onClick={() => setOpen((current) => !current)}
        title={`Previewing ${PAGE_ROUTES[active]}`}
        type="button"
      >
        <ActiveIcon className="h-3 w-3 text-amb-muted-foreground" />
        <span className="truncate">{PAGE_TYPE_LABELS[active]}</span>
        <span className="hidden font-amb-mono text-[11px] text-amb-muted-foreground sm:inline">
          {PAGE_ROUTES[active]}
        </span>
        <StatusDot built={built.includes(active)} generating={generating === active} />
        <ChevronDownIcon
          className={cx(
            "h-3 w-3 text-amb-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          )}
        />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-30 w-64 overflow-hidden rounded-amb-panel border border-amb-border bg-amb-background p-1 shadow-amb-md"
          id={menuId}
          role="menu"
        >
          {SITE_ROUTES.map(({ pageType, path }) => {
            const Icon = ICONS[pageType];
            const isActive = pageType === active;
            const exists = built.includes(pageType);
            const isGenerating = generating === pageType;

            return (
              <button
                aria-checked={isActive}
                className={cx(
                  "flex w-full items-start gap-2 rounded-amb-row px-2 py-1.5 text-left transition-colors",
                  isActive ? "bg-amb-secondary" : "hover:bg-amb-secondary",
                )}
                key={pageType}
                onClick={() => {
                  setOpen(false);
                  if (!exists && !isGenerating && onBuild) {
                    onBuild(pageType);
                    return;
                  }
                  if (!isActive) onChange(pageType);
                }}
                role="menuitemradio"
                type="button"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amb-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-amb-foreground">
                    {PAGE_TYPE_LABELS[pageType]}
                    <span className="font-amb-mono text-[11px] font-normal text-amb-muted-foreground">
                      {path}
                    </span>
                    <StatusDot built={exists} generating={isGenerating} />
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-amb-muted-foreground">
                    {isGenerating
                      ? "Writing this route now…"
                      : exists
                        ? "Built — preview it here"
                        : "Empty route — select it to build the page"}
                  </span>
                </span>
                {isActive ? (
                  <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amb-muted-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Green for built, a pulse for a run in flight, nothing for an empty route. */
function StatusDot({ built, generating }: { built: boolean; generating: boolean }) {
  if (generating) {
    return (
      <span aria-label="generating" className="h-1.5 w-1.5 animate-pulse rounded-full bg-amb-info" />
    );
  }
  if (built) return <span aria-label="built" className="h-1.5 w-1.5 rounded-full bg-amb-success" />;
  return null;
}
