"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "./format";
import {
  BrandMark,
  ChevronRightIcon,
  CloseIcon,
  HomeIcon,
  PagesIcon,
  SettingsIcon,
} from "./icons";
import { SignOutButton } from "./sign-out-button";

interface NavItem {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Home matches exactly; the rest own their subtree. */
  exact?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon, exact: true },
  { href: "/dashboard/projects", label: "Projects", Icon: PagesIcon },
  { href: "/dashboard/settings", label: "Settings", Icon: SettingsIcon },
];

const NAV_ROW =
  "flex h-8 items-center gap-2 rounded-amb-row px-2.5 py-1.5 text-[14px] font-medium transition-colors";

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

interface SidebarRailProps {
  email: string | null;
  /** Supplied only in the mobile drawer, where the rail can be dismissed. */
  onClose?: () => void;
}

/** The 255px rail: brand row, workspace row, nav, then the sign-out control. */
export function SidebarRail({ email, onClose }: SidebarRailProps) {
  const pathname = usePathname();
  const initial = email?.trim().charAt(0).toUpperCase() ?? "D";

  return (
    <>
      <div className="flex h-amb-topbar shrink-0 items-center gap-2.5 px-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 text-amb-foreground">
          <BrandMark />
          <span className="truncate text-[16px] font-semibold tracking-[-0.025em]">
            DropShipping
          </span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-amb-row text-amb-nav-idle transition-colors hover:bg-amb-sidebar-accent hover:text-amb-nav-active"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="px-2">
        <Link
          href="/dashboard/settings"
          className="relative flex h-9 items-center gap-2 rounded-amb-control bg-amb-card pr-2.5 pl-2 text-[14px]"
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
            focusable="false"
          >
            <rect
              x="0.125"
              y="0.125"
              width="calc(100% - 0.25px)"
              height="calc(100% - 0.25px)"
              rx="9.875"
              fill="none"
              stroke="#E6E6E6"
              strokeWidth="0.25"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amb-accent text-[10px] font-medium text-amb-foreground">
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-amb-foreground">
            {email ?? "Your workspace"}
          </span>
          <ChevronRightIcon className="h-3.5 w-3.5 text-amb-muted-foreground" />
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-[2px] overflow-y-auto px-2 pt-3 pb-11">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                NAV_ROW,
                active
                  ? "bg-amb-nav-active-bg text-amb-nav-active"
                  : "text-amb-nav-idle hover:bg-amb-sidebar-accent hover:text-amb-nav-active",
              )}
            >
              <item.Icon />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-amb-sidebar-border p-2">
        <SignOutButton />
      </div>
    </>
  );
}
