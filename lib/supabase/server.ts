import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { getSupabaseCredentials } from "./env";

/**
 * Server Supabase client for server components, server actions and route
 * handlers. Returns `null` when the env vars are missing.
 *
 * Cookie writes throw inside server components (they can only be set in
 * actions and route handlers); the middleware refresh keeps sessions alive, so
 * swallowing that specific failure is the documented pattern.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const credentials = getSupabaseCredentials();
  if (!credentials) return null;

  const cookieStore = await cookies();

  return createServerClient(credentials.url, credentials.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a server component — middleware already refreshed it.
        }
      },
    },
  });
}

/** The signed-in user, or `null` when signed out or Supabase is unconfigured. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
