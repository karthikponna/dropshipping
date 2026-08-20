import type { User } from "@supabase/supabase-js";

/**
 * The provider profile picture for a signed-in user, or `null` to fall back to
 * their initial.
 *
 * Google puts the same URL on both `avatar_url` and `picture`; other providers
 * set one or the other, so both are read. Email/password accounts have neither,
 * which is the common case and not an error.
 */

/**
 * Avatar hosts the image optimizer is allowed to fetch, kept in step with
 * `images.remotePatterns` in next.config.ts. A URL from anywhere else is
 * dropped here rather than handed to `next/image`, which answers a host it was
 * not configured for with a 400 rather than a missing image. Adding a provider
 * means adding its host in both places.
 */
const ALLOWED_AVATAR_DOMAINS = ["googleusercontent.com"];

export function resolveAvatarUrl(user: User | null): string | null {
  if (!user) return null;

  const metadata = user.user_metadata as Record<string, unknown> | null | undefined;
  const raw = metadata?.avatar_url ?? metadata?.picture;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // Provider metadata is user-writable on some providers, so it is treated as
  // untrusted input rather than assumed to be a well-formed image URL.
  if (url.protocol !== "https:") return null;

  const allowed = ALLOWED_AVATAR_DOMAINS.some((domain) => url.hostname.endsWith(`.${domain}`));
  return allowed ? url.toString() : null;
}
