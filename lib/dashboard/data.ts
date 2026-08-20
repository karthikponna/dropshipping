import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isPageType,
  normalizeTheme,
  type FileMap,
  type ProjectPages,
  type ProjectRecord,
  type ProjectWithVersion,
  type VersionRecord,
  type VersionSummary,
} from "@/lib/types";

/**
 * Server-side reads for the dashboard, the builder and the `/api/projects`
 * handlers. Every function degrades to an empty result when Supabase is
 * unconfigured or the visitor is signed out, so the console renders with blank
 * env vars.
 *
 * RLS scopes every query to the signed-in user, so no `user_id` filter is
 * needed beyond the insert path.
 */

export type DashboardSession =
  | { status: "unconfigured"; supabase: null; user: null }
  | { status: "signed_out"; supabase: SupabaseClient; user: null }
  | { status: "ready"; supabase: SupabaseClient; user: User };

export async function getDashboardSession(): Promise<DashboardSession> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "unconfigured", supabase: null, user: null };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: "signed_out", supabase, user: null };

  return { status: "ready", supabase, user: data.user };
}

/* ─────────────────────────────── projects ─────────────────────────────── */

export const PROJECT_COLUMNS =
  "id, user_id, name, page_type, initial_prompt, current_version_id, landing_version_id, product_version_id, created_at, updated_at";

/** `projects` as PostgREST returns it: `page_type` is still a plain string. */
export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  page_type: string;
  initial_prompt: string;
  current_version_id: string | null;
  landing_version_id: string | null;
  product_version_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A project row plus the number of generations saved against it. */
export interface ProjectListItem extends ProjectRecord {
  versionCount: number;
}

export function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    page_type: isPageType(row.page_type) ? row.page_type : "landing",
    initial_prompt: row.initial_prompt,
    current_version_id: row.current_version_id,
    // Null-coalesced rather than assumed present: a project created before
    // migration 0002 ran still answers reads, it just has no page pointers yet.
    landing_version_id: row.landing_version_id ?? null,
    product_version_id: row.product_version_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Newest first. Empty when Supabase is unconfigured or the read fails. */
export async function listProjects(): Promise<ProjectListItem[]> {
  const session = await getDashboardSession();
  if (session.status !== "ready") return [];

  const [projectsResult, versionsResult] = await Promise.all([
    session.supabase.from("projects").select(PROJECT_COLUMNS).order("updated_at", { ascending: false }),
    session.supabase.from("versions").select("project_id"),
  ]);

  if (projectsResult.error || !projectsResult.data) return [];

  const counts = new Map<string, number>();
  for (const row of (versionsResult.data ?? []) as { project_id: string }[]) {
    counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
  }

  return (projectsResult.data as unknown as ProjectRow[]).map((row) => ({
    ...toProjectRecord(row),
    versionCount: counts.get(row.id) ?? 0,
  }));
}

export const MIGRATION_HINT =
  "This database predates the multi-page migration, so reads are failing. Paste supabase/migrations/0002_page_types.sql into the Supabase SQL editor and run it.";

/**
 * True when the database is still on the 0001 schema.
 *
 * Worth one extra round trip only when a read came back empty: PostgREST
 * rejects a select naming a column that does not exist, so an un-migrated
 * database looks exactly like an account with no projects — and telling
 * somebody their shops are gone when they are not is the worst thing this page
 * could do.
 */
export async function isSchemaOutdated(): Promise<boolean> {
  const session = await getDashboardSession();
  if (session.status !== "ready") return false;

  const { error } = await session.supabase.from("versions").select("page_type").limit(1);
  return error?.code === "42703";
}

/** One project row, without loading any of its versions. */
export async function getProject(id: string): Promise<ProjectRecord | null> {
  const session = await getDashboardSession();
  if (session.status !== "ready") return null;

  const { data, error } = await session.supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toProjectRecord(data as unknown as ProjectRow);
}

/** One project with the version it is currently previewing. */
export async function getProjectWithVersion(id: string): Promise<ProjectWithVersion | null> {
  const session = await getDashboardSession();
  if (session.status !== "ready") return null;

  const project = await getProject(id);
  if (!project) return null;

  const version = project.current_version_id
    ? await getVersion(session.supabase, project.current_version_id)
    : null;

  return { ...project, current_version: version };
}

/* ─────────────────────────────── versions ─────────────────────────────── */

export const VERSION_COLUMNS = "id, project_id, page_type, idx, prompt, files, theme, created_at";
export const VERSION_SUMMARY_COLUMNS = "id, project_id, page_type, idx, prompt, created_at";

/** `versions` as PostgREST returns it: `files`/`theme` are untyped jsonb. */
export interface VersionRow {
  id: string;
  project_id: string;
  page_type: string;
  idx: number;
  prompt: string;
  files: unknown;
  theme: unknown;
  created_at: string;
}

/** Coerces the `files` jsonb into a `FileMap`, dropping anything unexpected. */
export function toFileMap(value: unknown): FileMap {
  if (typeof value !== "object" || value === null) return {};

  const files: FileMap = {};
  for (const [path, contents] of Object.entries(value as Record<string, unknown>)) {
    if (typeof contents === "string") files[path] = contents;
  }
  return files;
}

export function toVersionRecord(row: VersionRow): VersionRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    page_type: isPageType(row.page_type) ? row.page_type : "landing",
    idx: row.idx,
    prompt: row.prompt,
    files: toFileMap(row.files),
    theme: normalizeTheme(row.theme),
    created_at: row.created_at,
  };
}

async function getVersion(supabase: SupabaseClient, id: string): Promise<VersionRecord | null> {
  const { data, error } = await supabase
    .from("versions")
    .select(VERSION_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toVersionRecord(data as unknown as VersionRow);
}

/**
 * The newest version of each page type, which is what the builder boots from —
 * switching pages has to restore a tree without a round trip.
 */
export async function getProjectPages(project: ProjectRecord): Promise<ProjectPages> {
  const session = await getDashboardSession();
  if (session.status !== "ready") return { landing: null, product: null };

  const [landing, product] = await Promise.all([
    project.landing_version_id ? getVersion(session.supabase, project.landing_version_id) : null,
    project.product_version_id ? getVersion(session.supabase, project.product_version_id) : null,
  ]);

  return { landing, product };
}

/** History rows for the version drawer — `files`/`theme` omitted for weight. */
export async function listVersionSummaries(projectId: string): Promise<VersionSummary[]> {
  const session = await getDashboardSession();
  if (session.status !== "ready") return [];

  const { data, error } = await session.supabase
    .from("versions")
    .select(VERSION_SUMMARY_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as unknown as { page_type: string }[]).map((row) => ({
    ...(row as unknown as VersionSummary),
    page_type: isPageType(row.page_type) ? row.page_type : "landing",
  }));
}

/* ──────────────────────────────── metrics ─────────────────────────────── */

export interface DashboardMetrics {
  projectCount: number;
  generationCount: number;
  lastActivityAt: string | null;
}

/** Derived from the project list so the home page needs no extra round trip. */
export function deriveMetrics(projects: readonly ProjectListItem[]): DashboardMetrics {
  let lastActivityAt: string | null = null;
  let latest = Number.NEGATIVE_INFINITY;

  for (const project of projects) {
    const updated = Date.parse(project.updated_at);
    if (!Number.isNaN(updated) && updated > latest) {
      latest = updated;
      lastActivityAt = project.updated_at;
    }
  }

  return {
    projectCount: projects.length,
    generationCount: projects.reduce((total, project) => total + project.versionCount, 0),
    lastActivityAt,
  };
}
