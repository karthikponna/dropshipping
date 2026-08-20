import { resolveAnthropicKey } from "@/lib/anthropic-key";
import { createAnthropicClient } from "@/lib/ai/client";
import {
  FALLBACK_MODEL_CHOICES,
  isSelectableModel,
  type ModelChoice,
  type ModelsResponse,
} from "@/lib/ai/model";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /api/models — the Anthropic models this user's key can generate with.
 *
 * Asked of Anthropic rather than hardcoded, because "his own model" depends on
 * the key: a personal account and an org key reach different catalogues, and a
 * list baked into the bundle goes stale the day Anthropic ships anything. The
 * curated fallback only covers the case where the question cannot be asked.
 *
 * Never fails the caller. The dropdown is a convenience — if this 500s the
 * composer should still offer the defaults, so every error path returns a
 * usable list and says so with `source`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MODELS = 40;

function fallback(): Response {
  return Response.json(
    { models: [...FALLBACK_MODEL_CHOICES], source: "fallback" } satisfies ModelsResponse,
    // Not cached: the next request may be the one where the key works.
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return Response.json({ error: "Sign in to list models." }, { status: 401 });
    }
  }

  let apiKey: string;
  try {
    apiKey = (await resolveAnthropicKey()).key;
  } catch {
    return fallback();
  }

  try {
    const page = await createAnthropicClient(apiKey).models.list({ limit: MAX_MODELS });

    // Anthropic returns newest first, which is the order to keep: the model
    // someone wants is far more often the current one than a 2024 snapshot.
    const models = page.data
      .filter((model) => isSelectableModel(model.id))
      .map((model): ModelChoice => ({ id: model.id, label: model.display_name || model.id }));

    if (models.length === 0) return fallback();

    return Response.json({ models, source: "live" } satisfies ModelsResponse, {
      // The catalogue changes a few times a year; a minute of caching keeps a
      // builder that mounts repeatedly from re-asking on every visit.
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return fallback();
  }
}
