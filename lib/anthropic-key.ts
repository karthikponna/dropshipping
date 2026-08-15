import { decryptSecret, encryptSecret, isEncryptionConfigured, maskSecret } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GenerationError } from "@/lib/types";

/**
 * Request-time Anthropic key resolution: the signed-in user's own encrypted key
 * first, the ANTHROPIC_API_KEY env var as the fallback. Server-only.
 */

export type AnthropicKeySource = "user" | "env";

export interface ResolvedAnthropicKey {
  key: string;
  source: AnthropicKeySource;
}

const KEY_PREFIX = "sk-ant-";

export function looksLikeAnthropicKey(value: string): boolean {
  return value.trim().startsWith(KEY_PREFIX) && value.trim().length > 20;
}

/** The stored key for the signed-in user, decrypted. `null` if there isn't one. */
export async function getStoredAnthropicKey(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !isEncryptionConfigured()) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("anthropic_key_encrypted")
    .eq("id", user.id)
    .maybeSingle<{ anthropic_key_encrypted: string | null }>();

  if (error || !data?.anthropic_key_encrypted) return null;

  try {
    return decryptSecret(data.anthropic_key_encrypted);
  } catch {
    // Wrong APP_ENCRYPTION_KEY or a corrupted row — fall back to the env key.
    return null;
  }
}

/** Masked form of the stored key, for the settings screen. */
export async function getStoredAnthropicKeyPreview(): Promise<string | null> {
  const key = await getStoredAnthropicKey();
  return key ? maskSecret(key) : null;
}

/**
 * The key to call Anthropic with. Throws a typed `GenerationError` the route
 * handler can turn straight into an error event.
 */
export async function resolveAnthropicKey(): Promise<ResolvedAnthropicKey> {
  const userKey = await getStoredAnthropicKey();
  if (userKey) return { key: userKey, source: "user" };

  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return { key: envKey, source: "env" };

  throw new GenerationError(
    "missing_key",
    "No Anthropic API key available. Add one in Settings, or set ANTHROPIC_API_KEY in .env.local.",
    { retryable: false },
  );
}

/** Encrypts and stores the key on the signed-in user's profile. */
export async function saveAnthropicKey(rawKey: string): Promise<void> {
  const key = rawKey.trim();

  if (!looksLikeAnthropicKey(key)) {
    throw new GenerationError("invalid_key", `An Anthropic API key starts with "${KEY_PREFIX}".`, {
      retryable: false,
    });
  }

  if (!isEncryptionConfigured()) {
    throw new GenerationError(
      "missing_key",
      "APP_ENCRYPTION_KEY is not set, so the key cannot be stored securely.",
      { retryable: false },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    throw new GenerationError("unauthorized", "Supabase is not configured.", { retryable: false });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new GenerationError("unauthorized", "Sign in to save an API key.", { retryable: false });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ anthropic_key_encrypted: encryptSecret(key) })
    .eq("id", user.id);

  if (error) {
    throw new GenerationError("upstream_error", error.message);
  }
}

/** Removes the stored key so generation falls back to the env key. */
export async function clearAnthropicKey(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("profiles")
    .update({ anthropic_key_encrypted: null })
    .eq("id", user.id);

  if (error) {
    throw new GenerationError("upstream_error", error.message);
  }
}
