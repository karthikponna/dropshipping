import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseCredentials } from "./env";

let cached: SupabaseClient | null = null;

/**
 * Browser Supabase client for client components.
 *
 * Returns `null` when the public env vars are missing so the UI can render a
 * disabled state instead of crashing the whole tree.
 */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  if (cached) return cached;

  const credentials = getSupabaseCredentials();
  if (!credentials) return null;

  cached = createBrowserClient(credentials.url, credentials.anonKey);
  return cached;
}
