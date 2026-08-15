/**
 * Supabase credentials, read defensively.
 *
 * The app must boot without them so other agents can run `npm run dev` before
 * the user pastes their keys: every Supabase factory returns `null` when the
 * env vars are absent and callers degrade instead of throwing.
 */

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

/** Referenced literally so Next can inline the public vars in client bundles. */
export function getSupabaseCredentials(): SupabaseCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseCredentials() !== null;
}

export const SUPABASE_SETUP_HINT =
  "Supabase is not configured. Copy .env.example to .env.local, paste your project URL and anon key, then restart the dev server.";
