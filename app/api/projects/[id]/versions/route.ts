import { NextResponse } from "next/server";

import {
  getDashboardSession,
  listVersionSummaries,
  toVersionRecord,
  type VersionRow,
} from "@/components/dashboard/data";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";
import { normalizeTheme, type FileMap, type VersionRecord } from "@/lib/types";

/**
 * Version history for one project.
 *
 *   GET  → 200 { versions: VersionSummary[] }   newest first, files omitted
 *   POST → 201 { version: VersionRecord }
 *          body { prompt: string; files: FileMap; theme?: Theme; setCurrent?: boolean }
 *
 * POST appends the next `idx` and, unless `setCurrent` is false, points the
 * project's `current_version_id` at the new row.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VERSION_COLUMNS = "id, project_id, idx, prompt, files, theme, created_at";

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

interface CreateVersionBody {
  prompt?: unknown;
  files?: unknown;
  theme?: unknown;
  setCurrent?: unknown;
}

function readFileMap(value: unknown): FileMap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const files: FileMap = {};
  for (const [path, contents] of Object.entries(value as Record<string, unknown>)) {
    if (typeof contents !== "string") return null;
    files[path] = contents;
  }
  return Object.keys(files).length > 0 ? files : null;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateVersionBody;
  try {
    body = (await request.json()) as CreateVersionBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const files = readFileMap(body.files);
  if (!files) {
    return NextResponse.json(
      { error: "`files` must be a non-empty map of path → file contents." },
      { status: 400 },
    );
  }

  // RLS would reject the insert anyway; checking first gives a clearer status.
  const { data: project, error: projectError } = await session.supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const { data: latest } = await session.supabase
    .from("versions")
    .select("idx")
    .eq("project_id", id)
    .order("idx", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextIdx = ((latest as { idx: number } | null)?.idx ?? 0) + 1;

  const { data, error } = await session.supabase
    .from("versions")
    .insert({
      project_id: id,
      idx: nextIdx,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      files,
      theme: normalizeTheme(body.theme),
    })
    .select(VERSION_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "The version could not be saved." },
      { status: 500 },
    );
  }

  const version: VersionRecord = toVersionRecord(data as unknown as VersionRow);

  if (body.setCurrent !== false) {
    const { error: pointerError } = await session.supabase
      .from("projects")
      .update({ current_version_id: version.id })
      .eq("id", id);

    if (pointerError) return NextResponse.json({ error: pointerError.message }, { status: 500 });
  }

  return NextResponse.json({ version }, { status: 201 });
}
