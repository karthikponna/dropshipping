import { DEFAULT_THEME, normalizeTheme, type PageType, type Theme } from "@/lib/types";

import { hydraQuery, type HydraRow } from "./client";
import {
  extractConcepts,
  extractTimeCue,
  referencesPastWork,
  requestsTheSame,
  type TimeCue,
} from "./concepts";
import { graphId, nodeKey } from "./ids";
import { getComponentInventory, getPastShops } from "./inspect";
import { LABEL, REL, fanOutIds } from "./schema";

/**
 * The read side: everything the graph can tell Claude that Postgres cannot.
 *
 * Three questions get answered here, each one a traversal rather than a row
 * lookup:
 *
 *   1. What design language is this project already using? (landing → product)
 *   2. Which components does this instruction actually touch? (IMPORTS walk)
 *   3. Which past shop is the user talking about? (concepts → projects, ranked)
 *
 * Every function degrades to `null` or `[]` when the node is unreachable, so a
 * caller never has to branch on whether the graph is available.
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

function themeFromRow(row: HydraRow): Theme {
  return normalizeTheme({
    colors: {
      primary: str(row, "primary") || DEFAULT_THEME.colors.primary,
      secondary: str(row, "secondary"),
      accent: str(row, "accent"),
      background: str(row, "background"),
      foreground: str(row, "foreground"),
    },
    fonts: {
      heading: str(row, "heading_font") || DEFAULT_THEME.fonts.heading,
      body: str(row, "body_font") || DEFAULT_THEME.fonts.body,
    },
    radius: str(row, "radius"),
  });
}

/* ───────────────────── 1. design inherited across pages ────────────────── */

export interface InheritedDesign {
  /** The generation whose look is being carried forward. */
  versionId: string;
  pageType: PageType;
  name: string;
  summary: string;
  theme: Theme;
  createdAt: number;
  /** Section names of the source page, so the new page can echo its structure. */
  components: string[];
}

/**
 * The design language already established for a project, from the newest
 * generation of a *different* page type.
 *
 * This is the answer to "the product page must not look like a different
 * company". When a user switches to Product page after building a landing page,
 * the palette, fonts and corner radius come from here and go into the system
 * prompt as a hard constraint rather than being re-invented.
 */
export async function getInheritedDesign(
  projectId: string,
  sourcePageType: PageType,
): Promise<InheritedDesign | null> {
  const project = graphId(nodeKey.project(projectId));

  const rows = await hydraQuery(
    [
      `MATCH (p:${LABEL.project} {id: $project})-[:${REL.hasGeneration}]->(g:${LABEL.generation} {page_type: $page_type})-[:${REL.usesTheme}]->(t:${LABEL.theme})`,
      "RETURN g.version_id AS version_id, g.name AS name, g.summary AS summary, g.created_at AS created_at,",
      "       t.primary AS primary, t.secondary AS secondary, t.accent AS accent,",
      "       t.background AS background, t.foreground AS foreground,",
      "       t.heading_font AS heading_font, t.body_font AS body_font, t.radius AS radius",
      "ORDER BY g.created_at DESC LIMIT 1",
    ].join("\n"),
    { project, page_type: sourcePageType },
  );

  const row = rows?.[0];
  if (!row) return null;

  return {
    versionId: str(row, "version_id"),
    pageType: sourcePageType,
    name: str(row, "name"),
    summary: str(row, "summary"),
    theme: themeFromRow(row),
    createdAt: num(row, "created_at"),
    components: await getComponentNames(projectId, sourcePageType),
  };
}

async function getComponentNames(projectId: string, pageType: PageType): Promise<string[]> {
  const inventory = await getComponentInventory(projectId, pageType);
  return inventory.filter((entry) => !entry.isEntry).map((entry) => entry.name).filter(Boolean);
}

/* ─────────────────── 2. bounded code context via IMPORTS ───────────────── */

export interface CodeContext {
  /** Paths worth sending to the model for this instruction. */
  paths: string[];
  /** True when the graph narrowed the set rather than falling back to all. */
  narrowed: boolean;
}

/**
 * Chooses which files a refinement needs to see.
 *
 * A generated shop is eight files and roughly 60k characters; sending all of it
 * on every "make the hero bigger" is what makes refinements slow and expensive.
 * The graph knows which component the instruction names and, through IMPORTS,
 * what that component depends on — so the prompt carries the entry file, the
 * named section, and its dependencies, and nothing else.
 *
 * Returns every path when nothing matches, because a wrong narrow context is far
 * worse than a large one: the model would rewrite a file it could not see.
 */
export async function getCodeContext({
  projectId,
  pageType,
  instruction,
  availablePaths,
  maxPaths = 6,
}: {
  projectId: string;
  pageType: PageType;
  instruction: string;
  availablePaths: readonly string[];
  maxPaths?: number;
}): Promise<CodeContext> {
  const all = { paths: [...availablePaths], narrowed: false };

  const components = await getComponentInventory(projectId, pageType);
  if (components.length === 0) return all;

  const lowered = instruction.toLowerCase();
  const seeds = components.filter((component) => {
    if (component.isEntry) return false;
    if (lowered.includes(component.name.toLowerCase())) return true;
    return component.purpose
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 4)
      .some((word) => lowered.includes(word));
  });

  // An instruction that names nothing recognisable ("make it feel warmer") is a
  // whole-page change; narrowing it would be a guess.
  if (seeds.length === 0) return all;

  const byId = new Map(components.map((component) => [component.id, component]));
  const selected = new Set<number>(seeds.map((seed) => seed.id));

  const entry = components.find((component) => component.isEntry);
  if (entry) selected.add(entry.id);

  // Walk IMPORTS outward. Two rounds is enough for a generated tree, which is
  // entry → sections → the odd shared helper.
  let frontier = seeds.map((seed) => seed.id);
  for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
    const edges = await hydraQuery(fanOutIds(REL.imports), {
      rows: frontier.map((id) => ({ id })),
    });
    if (!edges) break;

    const next: number[] = [];
    for (const edge of edges) {
      const target = num(edge, "target");
      if (target === 0 || selected.has(target) || !byId.has(target)) continue;
      selected.add(target);
      next.push(target);
    }
    frontier = next;
  }

  const paths = [...selected]
    .map((id) => byId.get(id)?.path)
    .filter((path): path is string => typeof path === "string" && availablePaths.includes(path));

  // Narrowing to almost everything saves nothing and risks dropping one file.
  if (paths.length === 0 || paths.length > maxPaths || paths.length >= availablePaths.length - 1) {
    return all;
  }

  return { paths, narrowed: true };
}

/* ──────────────────── 3. cross-session project recall ──────────────────── */

export interface RecalledProject {
  projectId: string;
  name: string;
  summary: string;
  updatedAt: number;
  theme: Theme;
  /** Concepts this prompt and that project have in common. */
  matchedConcepts: string[];
  /** The time phrase that helped find it, when there was one. */
  timePhrase: string | null;
}

const RECALL_MIN_OVERLAP = 2;

/**
 * What being inside the time window the prompt named is worth, in concept
 * points. Below the weight of a single shared word on purpose: a date is how
 * the user narrows between shops they described the same way, never how they
 * pick one they described at all.
 */
const WINDOW_BONUS = 0.5;

/**
 * Finds the past shop a prompt is referring to.
 *
 * "Build the site I made yesterday" carries no project id, so the graph has to
 * resolve it: the prompt's concepts are looked up as nodes, walked to every
 * project that mentions them, and the candidates ranked by how many concepts
 * they share and how recently they were touched. A time phrase, when present,
 * filters before ranking — it is the strongest signal available.
 *
 * When concept overlap finds nothing there is one fallback, and it is
 * deliberately narrow: see `recallMostRecent`.
 *
 * Returns null unless the prompt actually reaches for past work, so a plain new
 * shop never silently inherits an old one's look.
 */
export async function recallProject({
  userId,
  prompt,
  excludeProjectId,
  now = Date.now(),
}: {
  userId: string;
  prompt: string;
  excludeProjectId?: string;
  now?: number;
}): Promise<RecalledProject | null> {
  if (!referencesPastWork(prompt)) return null;

  const timeCue = extractTimeCue(prompt, now);
  const byTime = (): Promise<RecalledProject | null> =>
    recallMostRecent({ userId, prompt, timeCue, now, ...(excludeProjectId ? { excludeProjectId } : {}) });

  const concepts = extractConcepts(prompt);
  if (concepts.length === 0) return byTime();

  const conceptIds = concepts.map((concept) => ({
    id: graphId(nodeKey.concept(userId, concept.key)),
    label: concept.label,
    weight: concept.weight,
  }));

  const edges = await hydraQuery(fanOutIds(REL.mentionedBy), {
    rows: conceptIds.map(({ id }) => ({ id })),
  });
  if (!edges || edges.length === 0) return byTime();

  const labelById = new Map(conceptIds.map(({ id, label }) => [id, label]));
  const weightById = new Map(conceptIds.map(({ id, weight }) => [id, weight]));

  interface Candidate {
    score: number;
    matched: string[];
  }

  const candidates = new Map<number, Candidate>();
  for (const edge of edges) {
    const conceptNode = num(edge, "source");
    const projectNode = num(edge, "target");
    if (projectNode === 0) continue;

    const candidate = candidates.get(projectNode) ?? { score: 0, matched: [] };
    candidate.score += weightById.get(conceptNode) ?? 1;
    const label = labelById.get(conceptNode);
    if (label && !candidate.matched.includes(label)) candidate.matched.push(label);
    candidates.set(projectNode, candidate);
  }

  const excludeNode = excludeProjectId ? graphId(nodeKey.project(excludeProjectId)) : null;

  const ranked = [...candidates.entries()]
    .filter(([node, candidate]) => node !== excludeNode && candidate.matched.length >= RECALL_MIN_OVERLAP)
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, 5);

  if (ranked.length === 0) return byTime();

  return (await resolveBestCandidate(ranked, timeCue, now)) ?? (await byTime());
}

/**
 * The one fallback: a dated request for the same thing again, resolved to the
 * newest shop inside the window.
 *
 * It exists because the request this whole feature is for describes nothing.
 * "Create a website same as yesterday, take the same UI, just change the name
 * to Apple" reduces to the concepts *yesterday, take, change, name, apple* —
 * every one of them about the new page, none about the old one. Concept overlap
 * has nothing to work with, and yet the referent is completely unambiguous to a
 * human: the thing they built yesterday.
 *
 * Two conditions keep it from being a licence to guess. There must be a time
 * cue, so the window is bounded by something the user actually said. And the
 * prompt must be asking for sameness rather than naming a subject — because a
 * prompt that names a subject can be *wrong* about it, and "that motorcycle
 * parts catalogue I built last week" from someone who has never built one
 * should find nothing rather than find their skincare site.
 */
async function recallMostRecent({
  userId,
  prompt,
  timeCue,
  excludeProjectId,
  now,
}: {
  userId: string;
  prompt: string;
  timeCue: TimeCue | null;
  excludeProjectId?: string;
  now: number;
}): Promise<RecalledProject | null> {
  if (!timeCue || !requestsTheSame(prompt)) return null;

  const shops = await getPastShops({
    userId,
    ...(excludeProjectId ? { excludeProjectId } : {}),
    limit: 5,
  });

  // Already newest first, and the window is re-applied inside the hydration
  // below — this only has to pick the first shop that could qualify.
  const newest = shops.find((shop) => shop.updatedAt >= timeCue.since);
  if (!newest) return null;

  return resolveBestCandidate(
    [[graphId(nodeKey.project(newest.projectId)), { score: 0, matched: [] }]],
    timeCue,
    now,
  );
}

async function resolveBestCandidate(
  ranked: readonly (readonly [number, { score: number; matched: string[] }])[],
  timeCue: TimeCue | null,
  now: number,
): Promise<RecalledProject | null> {
  let best: RecalledProject | null = null;
  let bestScore = -Infinity;

  for (const [node, candidate] of ranked) {
    const rows = await hydraQuery(
      [
        `MATCH (p:${LABEL.project} {id: $project})-[:${REL.hasGeneration}]->(g:${LABEL.generation})-[:${REL.usesTheme}]->(t:${LABEL.theme})`,
        "RETURN p.project_id AS project_id, p.name AS name, p.summary AS summary, p.updated_at AS updated_at,",
        "       t.primary AS primary, t.secondary AS secondary, t.accent AS accent,",
        "       t.background AS background, t.foreground AS foreground,",
        "       t.heading_font AS heading_font, t.body_font AS body_font, t.radius AS radius",
        "ORDER BY g.created_at DESC LIMIT 1",
      ].join("\n"),
      { project: node },
    );

    const row = rows?.[0];
    if (!row) continue;

    const updatedAt = num(row, "updated_at");

    // Concept overlap decides what the user meant; the date only ever breaks a
    // tie. Falling outside the window used to disqualify a candidate outright,
    // which meant "the candle shop I built yesterday" could reject the candle
    // shop for being two days old and fall through to whatever was newest —
    // discarding the one part of the request the user was precise about. Being
    // inside the window is worth a nudge instead, small enough that it can only
    // separate shops the request describes equally well.
    const inWindow = !timeCue || updatedAt === 0 || updatedAt >= timeCue.since;
    const ageDays = Math.max(0, (now - updatedAt) / 86_400_000);
    const score = candidate.score + (inWindow ? WINDOW_BONUS : 0) - Math.min(ageDays, 30) * 0.05;

    if (score <= bestScore) continue;

    bestScore = score;
    best = {
      projectId: str(row, "project_id"),
      name: str(row, "name"),
      summary: str(row, "summary"),
      updatedAt,
      theme: themeFromRow(row),
      matchedConcepts: candidate.matched,
      timePhrase: timeCue?.phrase ?? null,
    };
  }

  return best;
}
