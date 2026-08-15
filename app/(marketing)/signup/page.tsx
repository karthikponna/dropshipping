import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign up" };

/* PLACEHOLDER — Wave 2 (marketing) builds the supermemory email/password form
   here. Wire it to `signUpAction` from lib/auth/actions.ts with
   `useActionState(signUpAction, AUTH_ACTION_INITIAL_STATE)`; fields are
   `email`, `password`, optional `fullName`. Render `state.notice` when the
   project has email confirmation on. Email/password only. */
export default function SignupPage() {
  return (
    <main className="sm-container sm-section">
      <p className="font-sm-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sm-blue">
        ⟩ Sign up
      </p>
      <h2 className="mt-4">Start building<span className="dot">.</span></h2>
      <p className="mt-4">Form pending — Wave 2 wires signUpAction.</p>
      <p className="mt-8 text-[14.5px]">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
