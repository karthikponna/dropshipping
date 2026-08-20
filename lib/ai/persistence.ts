import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GenerationError, PAGE_TYPE_POINTER } from "@/lib/types";
import type { FileMap, GenerationMeta, PageType, Theme } from "@/lib/types";

/**
 * Writes one finished generation to Supabase as a new `versions` row and points
 * the project at it.
 *
 * Every failure mode degrades rather than breaking generation: with Supabase
 * unconfigured this returns `null` and the endpoint still streams, which is what
 * makes local development without a database possible. The one exception is
 * ownership — writing into someone else's project throws `unauthorized`.
 */

export interface PersistVersionInput {
  projectId: string;
  /** Which page of the site this version is; `idx` counts per page type. */
  pageType: PageType;
  /** The prompt or refinement instruction that produced this version. */
  prompt: string;
  files: FileMap;
  theme: Theme;
  meta?: GenerationMeta | null;
}

export interface PersistedVersion {
  versionId: string;
  projectId: string;
  idx: number;
}

/** Name `projects.name` defaults to, and therefore the only one we overwrite. */
const PLACEHOLDER_PROJECT_NAME = "Untitled shop";

export async function persistGeneratedVersion(
  input: PersistVersionInput,
): Promise<PersistedVersion | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new GenerationError("unauthorized", "Sign in to save this generation.", { retryable: false });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, user_id, name")
    .eq("id", input.projectId)
    .maybeSingle<{ id: string; user_id: string; name: string | null }>();

  if (projectError) {
    throw new GenerationError("upstream_error", `Could not load the project: ${projectError.message}`);
  }
  if (!project || project.user_id !== user.id) {
    throw new GenerationError("unauthorized", "That project does not exist or does not belong to you.", {
      retryable: false,
    });
  }

  // Numbering runs per page type, so a site reads "landing v3, product v1"
  // rather than one interleaved sequence across two different pages.
  const { data: latest, error: latestError } = await supabase
    .from("versions")
    .select("idx")
    .eq("project_id", input.projectId)
    .eq("page_type", input.pageType)
    .order("idx", { ascending: false })
    .limit(1)
    .maybeSingle<{ idx: number }>();

  if (latestError) {
    throw new GenerationError("upstream_error", `Could not read the version history: ${latestError.message}`);
  }

  const idx = (latest?.idx ?? 0) + 1;

  const { data: version, error: insertError } = await supabase
    .from("versions")
    .insert({
      project_id: input.projectId,
      page_type: input.pageType,
      idx,
      prompt: input.prompt,
      files: input.files,
      theme: input.theme,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !version) {
    throw new GenerationError(
      "upstream_error",
      `Could not save this version: ${insertError?.message ?? "no row returned"}`,
    );
  }

  const shouldRename =
    typeof input.meta?.name === "string" &&
    input.meta.name.trim().length > 0 &&
    (project.name === null || project.name.trim().length === 0 || project.name === PLACEHOLDER_PROJECT_NAME);

  // Three pointers move at once: the page type's own pointer (so switching back
  // to this page restores this tree), the project-wide one (what the dashboard
  // card previews), and the active page type (what the builder opens on).
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      current_version_id: version.id,
      [PAGE_TYPE_POINTER[input.pageType]]: version.id,
      page_type: input.pageType,
      updated_at: new Date().toISOString(),
      ...(shouldRename ? { name: input.meta?.name.trim() } : {}),
    })
    .eq("id", input.projectId);

  if (updateError) {
    throw new GenerationError(
      "upstream_error",
      `Saved the version but could not point the project at it: ${updateError.message}`,
    );
  }

  return { versionId: version.id, projectId: input.projectId, idx };
}
