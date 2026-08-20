"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { SidebarRail } from "./sidebar-rail";
import { Topbar } from "./topbar";

interface DashboardShellProps {
  children: React.ReactNode;
  email: string | null;
  /** Provider profile picture; `null` for email/password accounts. */
  avatarUrl?: string | null;
  /** Setup warning rendered above the content column, e.g. missing env vars. */
  notice?: string | null;
}

/**
 * The console frame: a 255px rail on the left (a dismissible drawer below
 * `sm`), a topbar, and the page in the remaining column.
 *
 * The frame is exactly one viewport tall and `<main>` is the only scroller.
 * That is what lets the builder fill the pane with `h-full` no matter what
 * else is above it — a setup notice, say — instead of guessing at the offset
 * with `calc(100dvh - ...)` and hanging its composer below the fold.
 */
export function DashboardShell({ children, email, avatarUrl, notice }: DashboardShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden h-full w-amb-sidebar shrink-0 flex-col border-r border-amb-sidebar-border bg-amb-sidebar sm:flex">
        <SidebarRail />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/20"
          />
          <div className="relative flex h-full w-amb-sidebar max-w-[86%] flex-col border-r border-amb-sidebar-border bg-amb-sidebar shadow-amb-xl">
            <SidebarRail onClose={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        {notice && (
          <p className="shrink-0 border-b border-amb-border bg-amb-warning-bg px-4 py-2 text-[12px] text-amb-warning-foreground">
            {notice}
          </p>
        )}
        <Topbar avatarUrl={avatarUrl} email={email} onOpenMenu={() => setMenuOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
