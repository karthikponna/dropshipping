"use client";

import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { AuthError } from "./auth-card";
import { cx } from "./cx";

/**
 * Google sign-in. One button serves both pages: to Supabase there is no
 * difference between signing up and signing in with a provider — the first
 * time through creates the user, every time after resolves to the same one.
 *
 * It has to run in the browser. `signInWithOAuth` stores the PKCE verifier
 * client-side before handing off to Google, and the code that comes back is
 * traded for a session in /auth/callback.
 */

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-[17px] w-[17px]" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function GoogleButton({ label, next }: { label: string; next?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Missing env vars are a deployment problem, not a user-facing one: the
  // email form beside this already renders its own setup hint, so hiding the
  // provider is better than offering a button that cannot work.
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;

  const start = async (): Promise<void> => {
    setPending(true);
    setError(null);

    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });

    // On success the browser is already navigating to Google, so there is no
    // success branch to write — only the failure to hand off is ours to report.
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <AuthError message={error} /> : null}

      <button
        type="button"
        onClick={start}
        disabled={pending}
        aria-busy={pending}
        className={cx(
          "inline-flex h-11 w-full items-center justify-center gap-2.5 border border-sm-border bg-white px-5",
          "font-sm-body text-[14.5px] font-medium tracking-[-0.005em] text-sm-text",
          "transition-[background-color,border-color,transform] duration-[180ms] ease-sm-out-strong",
          "hover:border-sm-text hover:bg-sm-paper active:scale-[0.985]",
          "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:border-sm-border disabled:hover:bg-white",
          "motion-reduce:transition-none motion-reduce:active:scale-100",
        )}
      >
        <GoogleMark />
        {pending ? "Redirecting to Google" : label}
      </button>
    </div>
  );
}

/** Rule with a centred label, separating the provider from the email form. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-sm-border-light" />
      <span className="font-sm-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-sm-text-dim uppercase">
        {label}
      </span>
      <span className="h-px flex-1 bg-sm-border-light" />
    </div>
  );
}
