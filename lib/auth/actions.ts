"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";
import type { AuthActionState } from "@/lib/types";

/**
 * Email/password auth only — there is no OAuth provider anywhere in this app.
 *
 * All three actions match React's `useActionState` shape:
 *   (prevState: AuthActionState, formData: FormData) => Promise<AuthActionState>
 * Form fields: `email`, `password`, optional `fullName` (signup) and `next`.
 */

const MIN_PASSWORD_LENGTH = 8;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Only same-origin paths, so a crafted `next` can't bounce users off-site. */
function safeRedirectTarget(value: string, fallback: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return fallback;
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = readField(formData, "email");
  const password = formData.get("password");
  const next = safeRedirectTarget(readField(formData, "next"), "/dashboard");

  if (!email || typeof password !== "string" || password.length === 0) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: SUPABASE_SETUP_HINT };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = readField(formData, "email");
  const fullName = readField(formData, "fullName");
  const password = formData.get("password");
  const next = safeRedirectTarget(readField(formData, "next"), "/dashboard");

  if (!email) return { error: "Enter your email address." };
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: SUPABASE_SETUP_HINT };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: fullName ? { data: { full_name: fullName } } : undefined,
  });

  if (error) {
    return { error: error.message };
  }

  // No session means the project has email confirmation switched on.
  if (!data.session) {
    return {
      error: null,
      notice: "Check your inbox to confirm your email, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
