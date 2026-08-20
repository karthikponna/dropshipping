"use client";

import Link from "next/link";

import { AccountMenu } from "./account-menu";
import { MenuIcon, PagesIcon, SparkleIcon } from "./icons";

const GHOST =
  "inline-flex h-amb-control items-center gap-1.5 rounded-amb-row border border-amb-border px-2.5 text-[14px] tracking-[-0.01em] text-black/80 transition-colors hover:bg-amb-muted";

interface TopbarProps {
  email: string | null;
  avatarUrl?: string | null;
  onOpenMenu: () => void;
}

/** Right-aligned chrome: 32px ghost buttons, then the account avatar. */
export function Topbar({ email, avatarUrl, onOpenMenu }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-amb-topbar shrink-0 items-center gap-2 border-b border-amb-border bg-amb-background/85 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="flex h-8 w-8 items-center justify-center rounded-amb-row border border-amb-border text-amb-foreground transition-colors hover:bg-amb-muted sm:hidden"
      >
        <MenuIcon />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Link href="/dashboard" className={GHOST}>
          <SparkleIcon className="h-3.5 w-3.5" />
          New Chat
        </Link>
        <Link href="/dashboard/projects" className={GHOST}>
          <PagesIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Projects</span>
        </Link>
        <AccountMenu avatarUrl={avatarUrl} email={email} />
      </div>
    </header>
  );
}
