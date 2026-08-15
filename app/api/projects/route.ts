import { NextResponse } from "next/server";

import {
  getDashboardSession,
  listProjects,
  PROJECT_COLUMNS,
  toProjectRecord,
  type ProjectRow,
} from "@/components/dashboard/data";
import { deriveProjectName } from "@/components/dashboard/format";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";
import { isPageType, type PageType, type ProjectRecord } from "@/lib/types";

/**
 * Project collection.
 *
 *   GET  → 200 { projects: ProjectListItem[] }
 *   POST → 201 { project: ProjectRecord }
 *          body { pageType: PageType; prompt: string; name?: string }
 *
 * Errors are `{ error: string }` with 401 (signed out), 400 (bad body),
 * 500 (database) or 503 (Supabase unconfigured).
 */

export async function GET(): Promise<NextResponse> {
  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ projects: await listProjects() });
}

interface CreateProjectBody {
  pageType?: unknown;
  prompt?: unknown;
  name?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getDashboardSession();
  if (session.status === "unconfigured") {
    return NextResponse.json({ error: SUPABASE_SETUP_HINT }, { status: 503 });
  }
  if (session.status === "signed_out") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateProjectBody;
  try {
    body = (await request.json()) as CreateProjectBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length === 0) {
    return NextResponse.json({ error: "`prompt` is required." }, { status: 400 });
  }
  if (!isPageType(body.pageType)) {
    return NextResponse.json(
      { error: "`pageType` must be 'landing' or 'product'." },
      { status: 400 },
    );
  }

  const pageType: PageType = body.pageType;
  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 80)
      : deriveProjectName(prompt);

  const { data, error } = await session.supabase
    .from("projects")
    .insert({
      user_id: session.user.id,
      name,
      page_type: pageType,
      initial_prompt: prompt,
    })
    .select(PROJECT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "The project could not be created." },
      { status: 500 },
    );
  }

  const project: ProjectRecord = toProjectRecord(data as unknown as ProjectRow);
  return NextResponse.json({ project }, { status: 201 });
}
