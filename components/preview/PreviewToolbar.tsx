"use client";

import type { ReactNode } from "react";

import {
  PREVIEW_DEVICE_WIDTHS,
  type PreviewDevice,
  type PreviewTab,
} from "@/lib/types";

import { DesktopIcon, MobileIcon, TabletIcon } from "./icons";
import { RouteSwitcher, type RouteSwitcherProps } from "./RouteSwitcher";

const TABS: ReadonlyArray<{ id: PreviewTab; label: string }> = [
  { id: "preview", label: "Preview" },
  { id: "code", label: "Code" },
];

const DEVICES: ReadonlyArray<{ id: PreviewDevice; label: string; Icon: typeof DesktopIcon }> = [
  { id: "desktop", label: "Desktop", Icon: DesktopIcon },
  { id: "tablet", label: "Tablet", Icon: TabletIcon },
  { id: "mobile", label: "Mobile", Icon: MobileIcon },
];

export interface PreviewToolbarProps {
  tab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  /** Ids for the two tab panels, so the tabs can own `aria-controls`. */
  panelIds: Record<PreviewTab, string>;
  /** Shows the generating indicator and dims the device controls. */
  isStreaming?: boolean;
  /** Number of generated files, shown next to the Code tab. */
  fileCount?: number;
  /**
   * Which route of the shop is on screen. Omit for a panel that previews a
   * single tree and has no other route to offer.
   */
  routes?: RouteSwitcherProps;
  /** Rendered at the right end — e.g. an Export .zip button from Wave 3. */
  actions?: ReactNode;
}

const segment =
  "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors";

export function PreviewToolbar({
  tab,
  onTabChange,
  device,
  onDeviceChange,
  panelIds,
  isStreaming = false,
  fileCount = 0,
  routes,
  actions,
}: PreviewToolbarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-amb-border bg-amb-background px-3 sm:gap-3">
      <div
        aria-label="Preview mode"
        className="inline-flex items-center gap-0.5 rounded-amb-row border border-amb-border bg-amb-muted p-0.5"
        role="tablist"
      >
        {TABS.map(({ id, label }) => {
          const isActive = tab === id;
          return (
            <button
              aria-controls={panelIds[id]}
              aria-selected={isActive}
              className={[
                segment,
                isActive
                  ? "bg-amb-background text-amb-foreground shadow-amb-xs"
                  : "text-amb-muted-foreground hover:text-amb-foreground",
              ].join(" ")}
              key={id}
              onClick={() => onTabChange(id)}
              role="tab"
              type="button"
            >
              {label}
              {id === "code" && fileCount > 0 ? (
                <span className="font-amb-mono text-[11px] text-amb-muted-foreground">
                  {fileCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {routes ? <RouteSwitcher {...routes} /> : null}

      {tab === "preview" ? (
        <div
          aria-label="Preview width"
          // Hidden on phones: the pane is already narrower than the smallest
          // device width, so every choice would render at the same scale.
          className="hidden items-center gap-0.5 rounded-amb-row border border-amb-border bg-amb-muted p-0.5 sm:inline-flex"
          role="group"
        >
          {DEVICES.map(({ id, label, Icon }) => {
            const isActive = device === id;
            return (
              <button
                aria-label={`${label} — ${PREVIEW_DEVICE_WIDTHS[id]}px`}
                aria-pressed={isActive}
                className={[
                  segment,
                  isActive
                    ? "bg-amb-background text-amb-foreground shadow-amb-xs"
                    : "text-amb-muted-foreground hover:text-amb-foreground",
                ].join(" ")}
                key={id}
                onClick={() => onDeviceChange(id)}
                title={`${label} — ${PREVIEW_DEVICE_WIDTHS[id]}px`}
                type="button"
              >
                <Icon />
              </button>
            );
          })}
          <span className="px-1.5 font-amb-mono text-[11px] text-amb-muted-foreground">
            {PREVIEW_DEVICE_WIDTHS[device]}
          </span>
        </div>
      ) : null}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {isStreaming ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amb-muted px-2.5 py-1 text-[12px] text-amb-muted-foreground">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-amb-info"
            />
            Generating
          </span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
