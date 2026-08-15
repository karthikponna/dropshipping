"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { SidebarRail } from "./sidebar-rail";
import { Topbar } from "./topbar";

interface DashboardShellProps {
  children: React.ReactNode;
  email: string | null;
  /** Setup warning rendered above the content column, e.g. missing env vars. */
  notice?: string | null;
}

/**
 * The console frame: a 255px rail on the left (a dismissible drawer below
 * `sm`), a sticky topbar, and the page in the remaining column.
 */
export function DashboardShell({ children, email, notice }: DashboardShellProps) {
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
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-amb-sidebar shrink-0 flex-col border-r border-amb-sidebar-border bg-amb-sidebar sm:flex">
        <SidebarRail email={email} />
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
            <SidebarRail email={email} onClose={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {notice && (
          <p className="border-b border-amb-border bg-amb-warning-bg px-4 py-2 text-[12px] text-amb-warning-foreground">
            {notice}
          </p>
        )}
        <Topbar email={email} onOpenMenu={() => setMenuOpen(true)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
