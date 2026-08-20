"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/dashboard/format";
import { BrandMark, CloseIcon, HomeIcon, PagesIcon, SettingsIcon } from "./icons";
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
  /** Supplied only in the mobile drawer, where the rail can be dismissed. */
  onClose?: () => void;
}

/**
 * The 255px rail: brand row, nav, then the sign-out control.
 *
 * It deliberately says nothing about who is signed in — that moved to the
 * account menu behind the topbar avatar, so the rail is navigation and nothing
 * else.
 */
export function SidebarRail({ onClose }: SidebarRailProps) {
  const pathname = usePathname();

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
