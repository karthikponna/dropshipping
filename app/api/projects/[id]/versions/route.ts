import { NextResponse } from "next/server";

import { getDashboardSession, listVersionSummaries } from "@/lib/dashboard/data";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";

/**
 * Version history for one project.
 *
 *   GET → 200 { versions: VersionSummary[] }   newest first, files omitted
 *
 * Read-only by design. Exactly one code path writes a `versions` row —
 * `persistGeneratedVersion`, called from the generation pipeline behind
 * `POST /api/generate`, which already holds the finished tree and does the
 * ownership check. This route briefly had a `POST` that inserted a row and
 * repointed `current_version_id` as well; a builder that called both would have
 * written two rows per generation, so it is gone. To move the pointer without
 * generating (restoring an older version), `PATCH /api/projects/[id]` with
 * `{ currentVersionId }`.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ versions: await listVersionSummaries(id) });
}
