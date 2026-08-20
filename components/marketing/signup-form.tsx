"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUpAction } from "@/lib/auth/actions";
import { AUTH_ACTION_INITIAL_STATE } from "@/lib/types";

import { AuthError, AuthField, AuthNotice } from "./auth-card";
import { SplitSubmit } from "./buttons";
import { AuthDivider, GoogleButton } from "./google-button";

/**
 * Signup with Google or with an email and password. When the Supabase project
 * has email confirmation on, the email path returns a notice instead of a
 * session — that path is rendered here in place of the form. Google never
 * reaches it: the provider has already verified the address.
 */
export function SignupForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signUpAction, AUTH_ACTION_INITIAL_STATE);

  if (state.notice) {
    return (
      <div className="flex flex-col gap-5">
        <AuthNotice message={state.notice} />
        <Link
          href="/login"
          className="inline-flex h-11 items-center justify-center border border-sm-border-light bg-sm-paper px-5 font-sm-body text-[14.5px] font-medium text-sm-text transition-colors duration-[180ms] ease-sm-out-strong hover:border-sm-text hover:bg-sm-bg-alt motion-reduce:transition-none"
        >
          Go to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <GoogleButton label="Sign up with Google" next={next} />
      <AuthDivider />

      <form action={formAction} className="flex flex-col gap-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {state.error ? <AuthError message={state.error} /> : null}

        <AuthField
          id="signup-name"
          name="fullName"
          label="Full name"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
        />

        <AuthField
          id="signup-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />

        <AuthField
          id="signup-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="8 characters minimum"
          required
        />

        <SplitSubmit
          label="Create account"
          pendingLabel="Creating account"
          pending={pending}
          className="mt-1"
        />
      </form>
    </div>
  );
}
