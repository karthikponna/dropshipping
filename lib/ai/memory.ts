import { getInheritedDesign, getCodeContext, ingestGeneration, recallProject } from "@/lib/hydra";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EMPTY_GENERATION_MEMORY, PAGE_TYPE_LABELS } from "@/lib/types";
import type {
  GenerateRequestBody,
  GenerationMemory,
  MemoryNotice,
  PageType,
  ProjectRecord,
} from "@/lib/types";

import { loadPageChrome } from "./past-project";
import type { PipelineRecall, PipelineRemember, RecallOptions, ResolvedMemory } from "./pipeline";

/**
 * Binds the generation pipeline to the HydraDB memory graph.
 *
 * Everything in here is best-effort by construction. `lib/hydra` already
 * swallows transport failures and returns empty results, and the two entry
 * points below add a second guard so an unexpected throw still cannot take down
 * a generation that is otherwise fine.
 */

/** The other page of the same site — the one whose design gets inherited. */
function otherPageType(pageType: PageType): PageType {
  return pageType === "landing" ? "product" : "landing";
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function loadProject(projectId: string): Promise<ProjectRecord | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle<ProjectRecord>();

  return data ?? null;
}

/* ────────────────────────────── recall ─────────────────────────────────── */

export const recallGenerationMemory: PipelineRecall = async (
  body: GenerateRequestBody,
  options: RecallOptions,
): Promise<ResolvedMemory> => {
  try {
    return await resolve(body, options);
  } catch (error) {
    console.warn("[hydra] recall failed; continuing without memory.", error);
    return { memory: EMPTY_GENERATION_MEMORY, notices: [] };
  }
};

async function resolve(body: GenerateRequestBody, options: RecallOptions): Promise<ResolvedMemory> {
  const userId = await currentUserId();
  const notices: MemoryNotice[] = [];
  const memory: GenerationMemory = { ...EMPTY_GENERATION_MEMORY };

  /* 1. A new page in a project that already has one: inherit its design. */
  if (body.projectId && body.mode === "create") {
    const source = otherPageType(body.pageType);
    const inherited = await getInheritedDesign(body.projectId, source);

    if (inherited) {
      // The palette comes out of the graph; the chrome has to come out of
      // Postgres, because the graph records that a Navbar exists and never what
      // was written in it. A page that cannot read it still inherits the look —
      // it just goes back to writing its own header.
      const chrome = await loadPageChrome(body.projectId, source);

      memory.inherited = {
        sourcePageType: source,
        theme: inherited.theme,
        shopName: inherited.name,
        summary: inherited.summary,
        sections: inherited.components,
        ...(chrome.length > 0 ? { chrome } : {}),
      };
      notices.push({
        kind: "inherited-design",
        message: `Matching your ${PAGE_TYPE_LABELS[source].toLowerCase()}'s design.`,
        detail: [
          inherited.theme.colors.primary,
          `${inherited.theme.fonts.heading} / ${inherited.theme.fonts.body}`,
          ...(chrome.length > 0
            ? [`reusing its ${chrome.map((file) => file.path.split("/").pop()).join(" and ")}`]
            : []),
        ].join(" · "),
      });
    }
  }

  /* 2. A prompt reaching back at earlier work: find the shop it means. */
  if (userId) {
    const recalled = await recallProject({
      userId,
      prompt: body.prompt,
      ...(body.projectId ? { excludeProjectId: body.projectId } : {}),
    });

    if (recalled) {
      memory.recalled = {
        projectId: recalled.projectId,
        name: recalled.name,
        summary: recalled.summary,
        theme: recalled.theme,
        matchedConcepts: recalled.matchedConcepts,
        timePhrase: recalled.timePhrase,
        updatedAt: recalled.updatedAt,
      };
      notices.push({
        kind: "recalled-project",
        message: recalled.timePhrase
          ? `Remembered "${recalled.name}" from ${recalled.timePhrase}.`
          : `Remembered "${recalled.name}" from an earlier session.`,
        detail:
          recalled.matchedConcepts.length > 0
            ? `matched on ${recalled.matchedConcepts.join(", ")}`
            : "",
        projectId: recalled.projectId,
      });
    }
  }

  /* 3. A refinement Claude did not investigate: narrow the files heuristically. */
  if (options.narrowContext && body.projectId && body.mode === "refine" && body.baseFiles) {
    const availablePaths = Object.keys(body.baseFiles);
    const context = await getCodeContext({
      projectId: body.projectId,
      pageType: body.pageType,
      instruction: body.prompt,
      availablePaths,
    });

    if (context.narrowed) {
      memory.contextPaths = context.paths;
      notices.push({
        kind: "narrowed-context",
        message: `Focused on ${context.paths.length} of ${availablePaths.length} files.`,
        detail: context.paths.join(", "),
      });
    }
  }

  return { memory, notices };
}

/* ────────────────────────────── remember ───────────────────────────────── */

/**
 * Writes a finished generation into the graph.
 *
 * `derivedFromVersionId` is the edge that makes the landing → product
 * relationship queryable later, so it is set from whatever the recall step
 * actually inherited rather than guessed at write time.
 */
export function rememberGeneration(body: GenerateRequestBody): PipelineRemember {
  return async ({ versionId, memory, files, theme, meta }): Promise<void> => {
    if (!body.projectId) return;

    try {
      const [userId, project] = await Promise.all([currentUserId(), loadProject(body.projectId)]);
      if (!userId || !project) return;

      const previousVersionId =
        body.pageType === "landing" ? project.landing_version_id : project.product_version_id;

      await ingestGeneration({
        userId,
        projectId: body.projectId,
        projectName: meta.name.trim() || project.name,
        sessionId: body.sessionId ?? body.projectId,
        versionId,
        pageType: body.pageType,
        prompt: body.prompt,
        mode: body.mode,
        files,
        theme,
        meta,
        previousVersionId,
        derivedFromVersionId: memory.inherited ? await inheritedVersionId(body, memory) : null,
      });
    } catch (error) {
      console.warn("[hydra] ingest failed; the graph is behind by one generation.", error);
    }
  };
}

/**
 * The version whose design this one inherited. Recall returned the theme but not
 * the row it came from, so read the project's pointer for that page type.
 */
async function inheritedVersionId(
  body: GenerateRequestBody,
  memory: GenerationMemory,
): Promise<string | null> {
  if (!body.projectId || !memory.inherited) return null;

  const project = await loadProject(body.projectId);
  if (!project) return null;

  return memory.inherited.sourcePageType === "landing"
    ? project.landing_version_id
    : project.product_version_id;
}
