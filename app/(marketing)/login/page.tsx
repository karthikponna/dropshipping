import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Log in" };

/* PLACEHOLDER — Wave 2 (marketing) builds the supermemory email/password form
   here. Wire it to `signInAction` from lib/auth/actions.ts with
   `useActionState(signInAction, AUTH_ACTION_INITIAL_STATE)`; fields are
   `email`, `password` and an optional hidden `next`. Email/password only. */
export default function LoginPage() {
  return (
    <main className="sm-container sm-section">
      <p className="font-sm-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sm-blue">
        ⟩ Log in
      </p>
      <h2 className="mt-4">Welcome back<span className="dot">.</span></h2>
      <p className="mt-4">Form pending — Wave 2 wires signInAction.</p>
      <p className="mt-8 text-[14.5px]">
        No account yet? <Link href="/signup">Sign up</Link>
      </p>
    </main>
  );
}
