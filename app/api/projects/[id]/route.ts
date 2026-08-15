import { NextResponse } from "next/server";

import {
  getDashboardSession,
  getProjectWithVersion,
  PROJECT_COLUMNS,
  toProjectRecord,
  type ProjectRow,
} from "@/components/dashboard/data";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";
import type { ProjectRecord } from "@/lib/types";

/**
 * One project.
 *
 *   GET    → 200 { project: ProjectWithVersion }
 *   PATCH  → 200 { project: ProjectRecord }
 *            body { name?: string; currentVersionId?: string | null }
 *   DELETE → 200 { ok: true }   (versions cascade)
 *
 * `currentVersionId` is how the builder restores a version: point the project
 * at an older row and the preview follows.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = { error: "Project not found." };
const MAX_NAME_LENGTH = 80;

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const project = await getProjectWithVersion(id);
  if (!project) return NextResponse.json(NOT_FOUND, { status: 404 });

  return NextResponse.json({ project });
}

interface PatchProjectBody {
  name?: unknown;
  currentVersionId?: unknown;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: PatchProjectBody;
  try {
    body = (await request.json()) as PatchProjectBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const patch: { name?: string; current_version_id?: string | null } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, MAX_NAME_LENGTH);
    if (name.length === 0) {
      return NextResponse.json({ error: "`name` cannot be empty." }, { status: 400 });
    }
    patch.name = name;
  }

  if (body.currentVersionId === null || typeof body.currentVersionId === "string") {
    patch.current_version_id = body.currentVersionId;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — send `name` or `currentVersionId`." },
      { status: 400 },
    );
  }

  const { data, error } = await session.supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json(NOT_FOUND, { status: 404 });

  const project: ProjectRecord = toProjectRecord(data as unknown as ProjectRow);
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { error } = await session.supabase.from("projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
