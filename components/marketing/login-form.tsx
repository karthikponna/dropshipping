"use client";

import { useActionState } from "react";

import { signInAction } from "@/lib/auth/actions";
import { AUTH_ACTION_INITIAL_STATE } from "@/lib/types";

import { AuthError, AuthField } from "./auth-card";
import { SplitSubmit } from "./buttons";

/** Email/password sign-in. `next` carries the path the middleware bounced from. */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, AUTH_ACTION_INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? <AuthError message={state.error} /> : null}

      <AuthField
        id="login-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
      />

      <AuthField
        id="login-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />

      <SplitSubmit label="Log in" pendingLabel="Signing in" pending={pending} className="mt-1" />
    </form>
  );
}
