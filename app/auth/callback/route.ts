import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where an OAuth provider lands the browser back.
 *
 * Supabase runs the exchange with Google itself, so what arrives here is a
 * Supabase-issued PKCE code, not Google's. Trading it for a session is what
 * writes the auth cookies, which is why this has to be a route handler:
 * a server component cannot set cookies.
 *
 * This path is deliberately outside the middleware's protected prefix and its
 * auth-route list — the user is neither signed in nor on a form yet, and
 * bouncing them anywhere before the exchange would drop the code.
 */

/** Only same-origin paths, so a crafted `next` can't bounce users off-site. */
function safeNext(value: string | null): string {
  if (!value) return "/dashboard";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

/**
 * Behind a proxy the request origin is the internal host, which would redirect
 * the user somewhere unreachable. `x-forwarded-host` carries the one they typed.
 */
function externalOrigin(request: Request, origin: string): string {
  if (process.env.NODE_ENV === "development") return origin;
  const forwardedHost = request.headers.get("x-forwarded-host");
  return forwardedHost ? `https://${forwardedHost}` : origin;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const base = externalOrigin(request, origin);
  const next = safeNext(searchParams.get("next"));

  // The provider itself failed or the user pressed cancel: `error_description`
  // is human-readable and worth showing rather than replacing with our own.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(`${base}/login?authError=${encodeURIComponent(providerError)}`);
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      `${base}/login?authError=${encodeURIComponent("That sign-in link was incomplete. Try again.")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(
      `${base}/login?authError=${encodeURIComponent("Supabase is not configured on this deployment.")}`,
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${base}/login?authError=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${base}${next}`);
}
