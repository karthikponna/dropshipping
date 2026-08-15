"use client";

import { useFormStatus } from "react-dom";

import { signOutAction } from "@/lib/auth/actions";

import { SignOutIcon } from "./icons";

function SignOutRow() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-8 w-full items-center gap-2 rounded-amb-row px-2.5 py-1.5 text-[14px] font-medium text-amb-nav-idle transition-colors hover:bg-amb-sidebar-accent hover:text-amb-nav-active disabled:opacity-60"
    >
      <SignOutIcon />
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}

/** Bottom of the sidebar rail. Styled as a nav row so the column reads evenly. */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SignOutRow />
    </form>
  );
}
