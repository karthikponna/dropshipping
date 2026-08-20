import type { HydraParameters } from "./client";

/**
 * The graph's vocabulary, and builders for the two write shapes HydraDB accepts.
 *
 * The model is deliberately small. Every node is one of seven labels and every
 * edge one of eight types, which keeps traversals short enough to stay inside
 * the generation's latency budget:
 *
 *   (:User)-[:OWNS]->(:Project)-[:HAS_SESSION]->(:Session)
 *                                    │
 *                                    └─[:HAS_GENERATION]->(:Generation)
 *
 *   (:Generation)-[:PRODUCED]->(:Component)-[:IMPORTS]->(:Component)
 *   (:Generation)-[:USES_THEME]->(:Theme)
 *   (:Generation)-[:FOLLOWS]->(:Generation)        chronological chain
 *   (:Generation)-[:DERIVED_FROM]->(:Generation)   product page ← landing page
 *   (:Project)-[:MENTIONS]->(:Concept)             and its reverse, MENTIONED_BY
 *
 * MENTIONED_BY exists only because HydraDB's batch fan-in requires the row id to
 * bind the *source* of the pattern, so "every project mentioning these concepts"
 * cannot be walked backwards along MENTIONS. Materialising the reverse edge is
 * the standard fix and costs one extra write per concept.
 */

export const LABEL = {
  user: "User",
  project: "Project",
  session: "Session",
  generation: "Generation",
  component: "Component",
  theme: "Theme",
  concept: "Concept",
} as const;

export type Label = (typeof LABEL)[keyof typeof LABEL];

export const REL = {
  owns: "OWNS",
  hasSession: "HAS_SESSION",
  hasGeneration: "HAS_GENERATION",
  produced: "PRODUCED",
  imports: "IMPORTS",
  usesTheme: "USES_THEME",
  follows: "FOLLOWS",
  derivedFrom: "DERIVED_FROM",
  mentions: "MENTIONS",
  mentionedBy: "MENTIONED_BY",
  revises: "REVISES",
} as const;

export type RelType = (typeof REL)[keyof typeof REL];

/* ─────────────────────────── property values ───────────────────────────── */

/**
 * HydraDB rejects null parameters outright, and its upsert names each property
 * statically in the SET clause — so a row that omits a property is not "unset",
 * it is a malformed batch. Callers therefore always supply every declared
 * property, and absent values arrive here already coerced to "" or 0.
 */
export type PropertyValue = string | number | boolean;

export interface NodeRow {
  id: number;
  [property: string]: PropertyValue;
}

export interface EdgeRow {
  id: number;
  src: number;
  dst: number;
  [property: string]: PropertyValue;
}

export interface Statement {
  query: string;
  parameters: HydraParameters;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`[hydra] unsafe property name: ${name}`);
  }
  return name;
}

/* ──────────────────────────── write builders ───────────────────────────── */

/**
 * Upsert nodes of one label.
 *
 * The MERGE pattern may carry the id and nothing else — label and properties
 * belong in SET — and exactly one label is allowed. Both are engine rules, not
 * style choices.
 */
export function upsertNodes(label: Label, properties: readonly string[], rows: readonly NodeRow[]): Statement {
  const assignments = properties.map((name) => `n.${assertIdentifier(name)} = row.${name}`);

  return {
    query: [
      "UNWIND $rows AS row",
      "MERGE (n {id: row.id})",
      `SET n:${label}${assignments.length > 0 ? `, ${assignments.join(", ")}` : ""}`,
    ].join(" "),
    parameters: { rows: rows as unknown as HydraParameters[keyof HydraParameters] },
  };
}

/**
 * Upsert relationships of one type between two known labels.
 *
 * Endpoints must each carry exactly one label here — the mirror image of the
 * read side, which forbids labels entirely.
 */
export function upsertEdges(
  type: RelType,
  from: Label,
  to: Label,
  rows: readonly EdgeRow[],
  properties: readonly string[] = [],
): Statement {
  const assignments = properties.map((name) => `r.${assertIdentifier(name)} = row.${name}`);

  return {
    query: [
      "UNWIND $rows AS row",
      `MATCH (s:${from} {id: row.src}), (d:${to} {id: row.dst})`,
      `MERGE (s)-[r:${type} {id: row.id}]->(d)`,
      ...(assignments.length > 0 ? [`SET ${assignments.join(", ")}`] : []),
    ].join(" "),
    parameters: { rows: rows as unknown as HydraParameters[keyof HydraParameters] },
  };
}

/**
 * The one legal batch fan-in: one hop, no labels, and exactly two projections
 * of which the first must be the row's own id. Anything richer has to be a
 * plain MATCH, or a hydration query per result.
 */
export function fanOutIds(type: RelType): string {
  return `UNWIND $rows AS row MATCH (s {id: row.id})-[:${type}]->(d) RETURN row.id AS source, d.id AS target`;
}
