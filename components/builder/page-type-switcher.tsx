"use client";

import { useId, useState } from "react";

import { CheckIcon, LayoutIcon, TagIcon } from "@/components/dashboard/icons";
import { cx } from "@/lib/dashboard/format";
import { useDismiss } from "@/lib/dashboard/use-dismiss";
import { PAGE_TYPES, PAGE_TYPE_LABELS, type PageType } from "@/lib/types";

import { ChevronDownIcon } from "./icons";

/**
 * Switches the builder between the two pages of one shop.
 *
 * A project holds a landing page and a product page, each with its own tree and
 * its own history, and this is how the user moves between them. The dot says the
 * page exists; a page without one starts empty, and the first prompt sent there
 * builds it — inheriting the other page's palette and type, so the two never
 * come out looking like different companies.
 *
 * It is a menu rather than a pair of tabs because the header also carries the
 * shop's name, and two full-width tabs left that name truncated to a few
 * characters in the 400px rail. Collapsed, the control is the width of one page
 * name; the alternative it hides is one click away and states which of the two
 * is already built.
 */

const ICONS: Record<PageType, (props: { className?: string }) => React.ReactElement> = {
  landing: LayoutIcon,
  product: TagIcon,
};

export interface PageTypeSwitcherProps {
  active: PageType;
  /** Page types that already have at least one generated version. */
  built: readonly PageType[];
  /** The page a run is currently generating, if any. */
  generating?: PageType | null;
  onChange: (pageType: PageType) => void;
  disabled?: boolean;
}

export function PageTypeSwitcher({
  active,
  built,
  generating,
  onChange,
  disabled = false,
}: PageTypeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const menuId = useId();

  const ActiveIcon = ICONS[active];
  // Something is being built somewhere else: worth a dot on the closed control,
  // because the page it refers to is the one currently out of sight.
  const generatingElsewhere = generating != null && generating !== active;

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Page: ${PAGE_TYPE_LABELS[active]}. Switch page`}
        {...(open ? { "aria-controls": menuId } : {})}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-amb-border bg-amb-muted pl-2.5 pr-1.5 text-[12px] font-medium transition-colors",
          open ? "bg-amb-secondary text-amb-foreground" : "text-amb-foreground hover:bg-amb-secondary",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ActiveIcon className="h-3 w-3 text-amb-muted-foreground" />
        <span>{PAGE_TYPE_LABELS[active]}</span>
        <StatusDot
          built={built.includes(active)}
          generating={generating === active}
        />
        <ChevronDownIcon
          className={cx("h-3 w-3 text-amb-muted-foreground transition-transform", open ? "rotate-180" : "")}
        />
        {generatingElsewhere && !open ? (
          <span
            aria-label={`Building the ${PAGE_TYPE_LABELS[generating].toLowerCase()}`}
            className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-amb-info ring-2 ring-amb-background"
          />
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+4px)] z-30 w-56 overflow-hidden rounded-amb-panel border border-amb-border bg-amb-background p-1 shadow-amb-md"
          id={menuId}
          role="menu"
        >
          {PAGE_TYPES.map((pageType) => {
            const Icon = ICONS[pageType];
            const isActive = pageType === active;
            const exists = built.includes(pageType);
            const isGenerating = generating === pageType;
            const blocked = disabled && !isActive;

            return (
              <button
                className={cx(
                  "flex w-full items-start gap-2 rounded-amb-row px-2 py-1.5 text-left transition-colors",
                  blocked
                    ? "cursor-not-allowed opacity-50"
                    : isActive
                      ? "bg-amb-secondary"
                      : "hover:bg-amb-secondary",
                )}
                disabled={blocked}
                key={pageType}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onChange(pageType);
                }}
                role="menuitemradio"
                aria-checked={isActive}
                type="button"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amb-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-amb-foreground">
                    {PAGE_TYPE_LABELS[pageType]}
                    <StatusDot built={exists} generating={isGenerating} />
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-amb-muted-foreground">
                    {isGenerating
                      ? "Building now…"
                      : exists
                        ? "Built — open it to refine"
                        : "Not built yet — it will reuse this shop's design"}
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

/** Green for built, a pulse for a run in flight, nothing for an empty page. */
function StatusDot({ built, generating }: { built: boolean; generating: boolean }) {
  if (generating) {
    return (
      <span aria-label="generating" className="h-1.5 w-1.5 animate-pulse rounded-full bg-amb-info" />
    );
  }
  if (built) return <span aria-label="built" className="h-1.5 w-1.5 rounded-full bg-amb-success" />;
  return null;
}
