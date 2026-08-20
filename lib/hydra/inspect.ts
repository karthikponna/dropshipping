import { isPageType } from "@/lib/types";
import type { InventoryEntry, PageType, PastShop, PastShopPage, SessionTurn } from "@/lib/types";

import { hydraQuery, type HydraRow } from "./client";
import { graphId, nodeKey } from "./ids";
import { LABEL, REL, fanOutIds } from "./schema";

/**
 * The reads the model drives itself.
 *
 * `retrieve.ts` answers questions the pipeline knows to ask before the model is
 * called. These answer questions only the model can ask, because they depend on
 * what it decides the instruction means — which is why each one is shaped as a
 * tool in `lib/ai/tools.ts` rather than as a prompt ingredient.
 *
 * The one that matters most is `getSessionHistory`. By the fourth or tenth turn
 * of a sitting the request is "now make that bit narrower", and the referent
 * lives in turn two. The generation stream never carries a transcript, but the
 * graph has been recording every turn as a `Generation` node since the first
 * one, so the chain is already there to be walked.
 *
 * `getPastShops` is the same trick pointed one level out: not this sitting, but
 * every sitting, so a brand-new chat saying "the same as yesterday" has a list
 * of shops with dates on it to resolve that against.
 */

/* ────────────────────────────── row helpers ────────────────────────────── */

function str(row: HydraRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function num(row: HydraRow, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : 0;
}

/* ──────────────────────────── 1. session turns ─────────────────────────── */

/**
 * Turns already generated in this sitting, oldest first.
 *
 * Bounded in the query rather than in the caller: a long sitting should cost
 * the same as a short one, and the oldest turns of a twenty-turn session are
 * not what "make that bit narrower" refers to.
 */
const SESSION_HISTORY_LIMIT = 12;

export async function getSessionHistory(sessionId: string): Promise<SessionTurn[]> {
  const rows = await hydraQuery(
    [
      `MATCH (s:${LABEL.session} {id: $session})-[:${REL.hasGeneration}]->(g:${LABEL.generation})`,
      "RETURN g.version_id AS version_id, g.page_type AS page_type, g.prompt AS prompt,",
      "       g.mode AS mode, g.name AS name, g.summary AS summary, g.created_at AS created_at",
      `ORDER BY g.created_at DESC LIMIT ${SESSION_HISTORY_LIMIT}`,
    ].join("\n"),
    { session: graphId(nodeKey.session(sessionId)) },
  );

  if (!rows) return [];

  return rows
    .map((row) => ({
      versionId: str(row, "version_id"),
      pageType: str(row, "page_type") === "product" ? ("product" as const) : ("landing" as const),
      prompt: str(row, "prompt"),
      mode: str(row, "mode"),
      name: str(row, "name"),
      summary: str(row, "summary"),
      createdAt: num(row, "created_at"),
    }))
    .filter((turn) => turn.prompt.length > 0)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/* ─────────────────────────── 2. component inventory ────────────────────── */

/**
 * Every component the graph has for one page of one project.
 *
 * This is the map the model reads before deciding which files to open. It is
 * deliberately metadata only: the point of the graph here is to let the model
 * choose three files out of eight without paying for all eight first.
 */
export async function getComponentInventory(
  projectId: string,
  pageType: PageType,
): Promise<InventoryEntry[]> {
  const rows = await hydraQuery(
    [
      `MATCH (c:${LABEL.component} {project_id: $project_id, page_type: $page_type})`,
      "RETURN c.id AS id, c.path AS path, c.name AS name, c.purpose AS purpose,",
      "       c.is_entry AS is_entry, c.is_client AS is_client, c.line_count AS line_count",
    ].join("\n"),
    { project_id: projectId, page_type: pageType },
  );

  if (!rows) return [];

  return rows
    .map((row) => ({
      id: num(row, "id"),
      path: str(row, "path"),
      name: str(row, "name"),
      purpose: str(row, "purpose"),
      isEntry: row.is_entry === true,
      isClient: row.is_client === true,
      lineCount: num(row, "line_count"),
    }))
    .filter((entry) => entry.path.length > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

/* ────────────────────────── 3. IMPORTS neighbours ──────────────────────── */

/**
 * What the given files depend on, walked outward along IMPORTS.
 *
 * The guarantee this buys is the reason the traversal exists at all: a model
 * that edits `Hero.tsx` without seeing the shared `Button.tsx` it imports will
 * invent a second Button. Similarity ranking over file contents cannot promise
 * that; an edge walk can.
 */
export async function getRelatedPaths({
  inventory,
  paths,
  depth = 2,
}: {
  inventory: readonly InventoryEntry[];
  paths: readonly string[];
  depth?: number;
}): Promise<string[]> {
  const byId = new Map(inventory.map((entry) => [entry.id, entry]));
  const idByPath = new Map(inventory.map((entry) => [entry.path, entry.id]));

  const seeds = paths.map((path) => idByPath.get(path)).filter((id): id is number => id !== undefined);
  if (seeds.length === 0) return [];

  const found = new Set<number>();
  let frontier = seeds;

  for (let round = 0; round < depth && frontier.length > 0; round += 1) {
    const edges = await hydraQuery(fanOutIds(REL.imports), {
      rows: frontier.map((id) => ({ id })),
    });
    if (!edges) break;

    const next: number[] = [];
    for (const edge of edges) {
      const target = num(edge, "target");
      if (target === 0 || found.has(target) || !byId.has(target)) continue;
      // A seed is already in front of the model; only its dependencies are news.
      found.add(target);
      if (!seeds.includes(target)) next.push(target);
    }
    frontier = next;
  }

  return [...found]
    .map((id) => byId.get(id)?.path)
    .filter((path): path is string => typeof path === "string" && !paths.includes(path))
    .sort();
}

/* ──────────────────────── 4. shops from other sittings ─────────────────── */

/**
 * How many generations the flat read pulls back before grouping. A user with a
 * handful of shops fits comfortably; one with hundreds gets their most recent
 * work, which is the only part "yesterday" can be pointing at.
 */
const PAST_GENERATION_LIMIT = 60;

/** Shops offered to the model at once. More is a longer list, not a better one. */
const PAST_SHOP_LIMIT = 6;

/**
 * Every shop this user has built, newest first, with the date of each page.
 *
 * This is the read that makes "the same as yesterday" answerable rather than
 * guessable. `recallProject` already ranks past projects by concept overlap and
 * folds a time cue into that ranking, but it answers with one project and a
 * theme — and a model that is about to reuse code needs to see the alternatives
 * and their dates before it commits to one.
 *
 * Deliberately one query. The generations come back flat, ordered by when they
 * were written, and are grouped per project here, so a user with a dozen shops
 * still costs a single round trip on the generation hot path.
 */
export async function getPastShops({
  userId,
  excludeProjectId,
  limit = PAST_SHOP_LIMIT,
}: {
  userId: string;
  excludeProjectId?: string;
  limit?: number;
}): Promise<PastShop[]> {
  const rows = await hydraQuery(
    [
      `MATCH (u:${LABEL.user} {id: $user})-[:${REL.owns}]->(p:${LABEL.project})-[:${REL.hasGeneration}]->(g:${LABEL.generation})`,
      "RETURN p.project_id AS project_id, p.name AS name, p.summary AS summary, p.updated_at AS updated_at,",
      "       g.page_type AS page_type, g.version_id AS version_id, g.created_at AS created_at",
      `ORDER BY g.created_at DESC LIMIT ${PAST_GENERATION_LIMIT}`,
    ].join("\n"),
    { user: graphId(nodeKey.user(userId)) },
  );

  if (!rows) return [];

  const shops = new Map<string, PastShop>();

  for (const row of rows) {
    const projectId = str(row, "project_id");
    if (projectId.length === 0 || projectId === excludeProjectId) continue;

    const rawPageType = str(row, "page_type");
    if (!isPageType(rawPageType)) continue;

    const shop = shops.get(projectId) ?? {
      projectId,
      name: str(row, "name"),
      summary: str(row, "summary"),
      updatedAt: num(row, "updated_at"),
      pages: [] as PastShopPage[],
    };

    // Rows arrive newest first, so the first sighting of a page type is its
    // current state and every later one is only a revision count.
    const page = shop.pages.find((entry) => entry.pageType === rawPageType);
    if (page) {
      page.generations += 1;
    } else {
      shop.pages.push({
        pageType: rawPageType,
        versionId: str(row, "version_id"),
        builtAt: num(row, "created_at"),
        generations: 1,
      });
    }

    shops.set(projectId, shop);
  }

  return [...shops.values()]
    .filter((shop) => shop.pages.length > 0)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}
