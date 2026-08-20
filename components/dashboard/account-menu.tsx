"use client";

import { useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useFormStatus } from "react-dom";

import { signOutAction } from "@/lib/auth/actions";
import { cx } from "@/lib/dashboard/format";
import { useDismiss } from "@/lib/dashboard/use-dismiss";

import { SettingsIcon, SignOutIcon } from "./icons";

/**
 * The avatar in the topbar, and the account menu it opens.
 *
 * The signed-in address used to sit in the sidebar under the brand, where it
 * cost a permanent row of the rail to say something a user needs about once a
 * session — usually only to check which account they are in. It lives here
 * instead, one click from the avatar that already stood for it, which also
 * gives the avatar somewhere to put Settings and Sign out.
 */

const ROW =
  "flex w-full items-center gap-2 rounded-amb-row px-2 py-1.5 text-left text-[13px] font-medium transition-colors";

interface AccountMenuProps {
  email: string | null;
  /** Provider profile picture; `null` for email/password accounts. */
  avatarUrl?: string | null;
}

export function AccountMenu({ email, avatarUrl = null }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  // A provider URL that 404s or is rate-limited would otherwise leave a broken
  // image where the account control is, so the first failure retires it for the
  // rest of the session and the initial takes over.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const menuId = useId();

  const initial = email?.trim().charAt(0).toUpperCase() ?? "D";
  const picture = avatarFailed ? null : avatarUrl;

  const avatar = (
    <Avatar initial={initial} onError={() => setAvatarFailed(true)} src={picture} />
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={email ? `Account — ${email}` : "Account"}
        {...(open ? { "aria-controls": menuId } : {})}
        className={cx(
          "flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-[13px] font-medium text-amb-foreground transition-colors",
          // A photo brings its own background; the tinted circle is only there
          // to give a bare initial something to sit on.
          picture ? "hover:opacity-90" : open ? "bg-amb-accent" : "bg-amb-secondary hover:bg-amb-accent",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {avatar}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-64 overflow-hidden rounded-amb-panel border border-amb-border bg-amb-background p-1 shadow-amb-md"
          id={menuId}
          role="menu"
        >
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span
              aria-hidden="true"
              className={cx(
                "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-medium text-amb-foreground",
                picture ? null : "bg-amb-secondary",
              )}
            >
              {avatar}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-amb-muted-foreground">Signed in as</span>
              {/* break-all rather than truncate: an address you cannot read in
                  full is not worth the row it takes. */}
              <span className="block text-[13px] leading-tight font-medium break-all text-amb-foreground">
                {email ?? "Your workspace"}
              </span>
            </span>
          </div>

          <div className="my-1 h-px bg-amb-border" />

          <Link
            className={cx(ROW, "text-amb-foreground hover:bg-amb-secondary")}
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <SettingsIcon className="h-3.5 w-3.5 text-amb-muted-foreground" />
            Settings
          </Link>

          <form action={signOutAction}>
            <SignOutRow />
          </form>
        </div>
      ) : null}
    </div>
  );
}

/** The picture if there is a usable one, otherwise the initial. */
function Avatar({
  src,
  initial,
  onError,
}: {
  src: string | null;
  initial: string;
  onError: () => void;
}) {
  if (!src) return <>{initial}</>;

  return (
    <Image
      alt=""
      className="h-full w-full object-cover"
      height={32}
      onError={onError}
      src={src}
      width={32}
    />
  );
}

/** Separate so `useFormStatus` can read the enclosing form's pending state. */
function SignOutRow() {
  const { pending } = useFormStatus();

  return (
    <button
      className={cx(ROW, "text-amb-foreground hover:bg-amb-secondary disabled:opacity-60")}
      disabled={pending}
      role="menuitem"
      type="submit"
    >
      <SignOutIcon className="h-3.5 w-3.5 text-amb-muted-foreground" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
