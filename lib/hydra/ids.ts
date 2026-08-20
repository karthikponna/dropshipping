import { createHash } from "node:crypto";

/**
 * Stable numeric identity for graph nodes and edges.
 *
 * HydraDB addresses every vertex and relationship by a numeric `id`, and its
 * upsert form (`MERGE (n {id: row.id}) SET …`) matches on that id alone. So the
 * app cannot lean on the database to mint identifiers: the same logical thing —
 * a project, a generated file, a concept — has to hash to the same number on
 * every run, in every process, or re-ingesting a project would fork it into
 * duplicate nodes instead of updating one.
 *
 * The digest is truncated to 52 bits rather than 64 because ids cross the wire
 * as JSON numbers, and anything above 2^53 stops round-tripping exactly through
 * a JavaScript double. At 52 bits a collision needs on the order of 10^7 nodes
 * before it is even worth worrying about, which is far past anything one user's
 * shops will produce.
 */

const ID_BITS = 52;
const ID_HEX_CHARS = ID_BITS / 4;

/** Hashes a namespaced key like `project:<uuid>` to a stable 52-bit integer. */
export function graphId(key: string): number {
  const digest = createHash("sha256").update(key).digest("hex");
  return Number.parseInt(digest.slice(0, ID_HEX_CHARS), 16);
}

/* ─────────────────────────── node key builders ─────────────────────────── */

export const nodeKey = {
  user: (userId: string): string => `user:${userId}`,
  project: (projectId: string): string => `project:${projectId}`,
  session: (sessionId: string): string => `session:${sessionId}`,
  generation: (versionId: string): string => `generation:${versionId}`,
  /** One node per file *per project*, so lineage is per-site, not global. */
  component: (projectId: string, pageType: string, path: string): string =>
    `component:${projectId}:${pageType}:${path}`,
  /** Themes are content-addressed: an identical palette is one shared node. */
  theme: (fingerprint: string): string => `theme:${fingerprint}`,
  /** Concepts are global per user, which is what makes recall cross-project. */
  concept: (userId: string, normalized: string): string => `concept:${userId}:${normalized}`,
} as const;

/** Edges need ids too; derive them from the triple they connect. */
export function edgeId(type: string, from: number, to: number): number {
  return graphId(`edge:${type}:${from}:${to}`);
}
