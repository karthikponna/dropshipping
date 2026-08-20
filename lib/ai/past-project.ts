import type { SupabaseClient } from "@supabase/supabase-js";

import { getComponentInventory, getPastShops } from "@/lib/hydra";
import { toFileMap } from "@/lib/dashboard/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTheme } from "@/lib/types";
import type {
  FileMap,
  PageType,
  PastShop,
  RecalledProjectContext,
  RecalledSource,
  Theme,
} from "@/lib/types";

import type { PastWorkResolver } from "./investigate";
import { CHROME_PATHS } from "./prompts/memory";

/**
 * The code of a shop built in an earlier session, read back on the server.
 *
 * Everything else on the memory path answers out of the graph, which stores how
 * things relate and never stores source. The source lives in Postgres, in
 * `versions.files`, and until now no generation ever opened it — a refinement
 * reads the tree the browser posted, and a brand-new session has no tree to
 * post. So "take the same UI as yesterday" could only ever be answered with a
 * palette. This is the file that changes that.
 *
 * Two things about it are load-bearing:
 *
 * **Ownership is checked here, explicitly.** The project id arrives from a tool
 * call, which means it arrives from the model, which means it is untrusted
 * input on a path that returns other people's source code if it is wrong. RLS
 * is what actually makes it safe — every query runs as the signed-in user
 * through their own session, there is no service-role key in this app to
 * bypass it with — but the row is compared against `auth.uid()` here as well,
 * so a future policy edit cannot quietly turn a tool call into a cross-account
 * read.
 *
 * **It is best-effort.** Unconfigured Supabase, a signed-out request, a project
 * that is not theirs, a version that was deleted: all of them return null and
 * the generation proceeds with whatever context it already had.
 */

/** Rejects a malformed id before Postgres has to, which keeps the log quiet. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PastPageSource {
  projectId: string;
  projectName: string;
  pageType: PageType;
  versionId: string;
  idx: number;
  createdAt: string;
  files: FileMap;
  theme: Theme;
}

interface VersionRow {
  id: string;
  idx: number;
  files: unknown;
  theme: unknown;
  created_at: string;
}

/** The newest generation of one page of a project the signed-in user owns. */
export async function loadPastPageSource(
  projectId: string,
  pageType: PageType,
): Promise<PastPageSource | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  return readPastPageSource(supabase, projectId, pageType);
}

/**
 * The read itself, against a client that already carries the user's session.
 *
 * Split out because `createSupabaseServerClient` needs `next/headers` and so
 * can only be built inside a request, while the two queries and the ownership
 * comparison below are the part worth pointing at a real Postgres. Given a
 * client signed in as somebody, this runs exactly as it does in a generation.
 */
export async function readPastPageSource(
  supabase: SupabaseClient,
  projectId: string,
  pageType: PageType,
): Promise<PastPageSource | null> {
  if (!UUID.test(projectId)) return null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: project } = await supabase
      .from("projects")
      .select("id, user_id, name")
      .eq("id", projectId)
      .maybeSingle<{ id: string; user_id: string; name: string | null }>();

    // RLS has already filtered this to the caller's own rows; comparing the
    // owner again costs nothing and means the guarantee does not rest on a
    // policy living in a different repository.
    if (!project || project.user_id !== user.id) {
      // Worth a line even though it is the expected answer to a hallucinated
      // id: this is the one place a model-supplied id is turned down, so a run
      // of these is either a confused model or somebody probing.
      console.warn(
        `[past-project] refused project ${projectId} for user ${user.id} — not theirs, or gone.`,
      );
      return null;
    }

    const { data: version } = await supabase
      .from("versions")
      .select("id, idx, files, theme, created_at")
      .eq("project_id", projectId)
      .eq("page_type", pageType)
      .order("idx", { ascending: false })
      .limit(1)
      .maybeSingle<VersionRow>();

    if (!version) return null;

    const files = toFileMap(version.files);

    // The only record that a generation reached outside itself for code. Paths
    // and counts, never contents: enough to answer "whose shop did that run
    // read, and was it theirs" from the log alone, without putting somebody's
    // source in it.
    console.info(
      `[past-project] user ${user.id} read ${Object.keys(files).length} files from their project ` +
        `${projectId} (${pageType} v${version.idx}, version ${version.id}).`,
    );

    return {
      projectId,
      projectName: project.name ?? "",
      pageType,
      versionId: version.id,
      idx: version.idx,
      createdAt: version.created_at,
      files,
      theme: normalizeTheme(version.theme),
    };
  } catch (error) {
    console.warn("[past-project] could not read an earlier shop's source.", error);
    return null;
  }
}

/* ─────────────────────── the investigation's view of it ────────────────── */

/**
 * Wires the past-work tools to the real graph and the real database.
 *
 * Injected into `createInvestigator` rather than imported by it, for the same
 * reason the Anthropic client is: this module reaches for `next/headers`, and
 * the investigation has to stay importable by an offline test and by a script
 * that has no request to read cookies out of.
 *
 * The source of one page is loaded once and cached for the turn. The model
 * reads a file at a time, but the row it is reading out of is a single jsonb
 * blob — fetching it per call would pay for the whole shop three times over.
 */
/**
 * The chrome of the other page of this same project, as source.
 *
 * A shop's two pages are written by two independent turns that share no state,
 * so anything the brief does not spell out they invent separately — one page's
 * footer offers a 14-day return window and a `.shop` contact address, the
 * other's offers 30 days and a `.com`. No wording of the instructions fixes
 * that, because the problem is not that the two turns disagree about the rule;
 * it is that there is no rule, only a blank the second turn has to fill.
 * Handing it the first turn's actual header and footer removes the blank.
 *
 * Deliberately not routed through the cross-session machinery next door. That
 * path exists to resolve *which* shop a vague request meant and asks the model
 * to decide; this one has no ambiguity to resolve — it is the same project, it
 * applies whether or not the prompt reaches backwards, and what it produces is
 * a constraint rather than a reference.
 */
export async function loadPageChrome(
  projectId: string,
  pageType: PageType,
): Promise<RecalledSource[]> {
  const page = await loadPastPageSource(projectId, pageType);
  if (!page) return [];

  return CHROME_PATHS.flatMap((path) => {
    const contents = page.files[path];
    return typeof contents === "string" && contents.trim().length > 0
      ? [{ path, contents }]
      : [];
  });
}

export const resolvePastWork: PastWorkResolver = async ({ recalled }) => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const shops = await getPastShops({ userId: user.id });
  const cache = new Map<string, FileMap>();

  return {
    shops: withRecalled(shops, recalled),
    now: Date.now(),
    components: (projectId, pageType) => getComponentInventory(projectId, pageType),
    source: async (projectId, pageType) => {
      const key = `${projectId}:${pageType}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const page = await readPastPageSource(supabase, projectId, pageType);
      const files = page?.files ?? {};
      cache.set(key, files);
      return files;
    },
  };
};

/**
 * Guarantees the shop recall already named is on the list.
 *
 * The two reads can disagree: recall walks `Concept ─MENTIONED_BY▶ Project`,
 * this walks `User ─OWNS▶ Project`, and an ingest that half-landed leaves one
 * edge without the other. When they disagree, the shop the user is actually
 * asking about is the one that has to survive.
 */
function withRecalled(shops: readonly PastShop[], recalled: RecalledProjectContext): PastShop[] {
  if (shops.some((shop) => shop.projectId === recalled.projectId)) return [...shops];

  return [
    {
      projectId: recalled.projectId,
      name: recalled.name,
      summary: recalled.summary,
      updatedAt: recalled.updatedAt,
      pages: [],
    },
    ...shops,
  ];
}
