import { createHash } from "node:crypto";

import type { FileMap, GenerationMeta, GenerationMode, PageType, Theme } from "@/lib/types";

import { hydraWriteBatch } from "./client";
import { extractConcepts } from "./concepts";
import { buildCodeGraph } from "./code-graph";
import { edgeId, graphId, nodeKey } from "./ids";
import { LABEL, REL, upsertEdges, upsertNodes, type EdgeRow, type NodeRow } from "./schema";

/**
 * Writes one finished generation into the graph.
 *
 * Ordering matters: every relationship batch matches its endpoints by id, so
 * nodes are written before the edges that reference them. `hydraWriteBatch`
 * stops at the first failed statement, which keeps a half-written generation
 * from sprouting edges into nodes that never landed.
 *
 * Nothing here is allowed to fail a generation. The caller has already streamed
 * a finished site to the browser and saved it to Postgres by the time this runs;
 * the graph is what makes the *next* generation smarter.
 */

export interface IngestGenerationInput {
  userId: string;
  projectId: string;
  projectName: string;
  /** Groups the generations a user produced in one sitting. */
  sessionId: string;
  /** Postgres `versions.id` — the graph and the database agree on identity. */
  versionId: string;
  pageType: PageType;
  prompt: string;
  mode: GenerationMode;
  files: FileMap;
  theme: Theme;
  meta: GenerationMeta;
  /** The generation this one refines or follows, if any. */
  previousVersionId?: string | null;
  /** Set when a product page was built on a landing page's design. */
  derivedFromVersionId?: string | null;
  createdAt?: number;
}

/**
 * Themes are content-addressed so an unchanged palette stays one node across
 * every generation that reuses it — which is what makes "these two pages share a
 * design" a single edge lookup rather than a field-by-field comparison.
 */
export function themeFingerprint(theme: Theme): string {
  const canonical = JSON.stringify({
    colors: theme.colors,
    fonts: theme.fonts,
    radius: theme.radius ?? "",
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Trims free text to something worth storing as a node property. */
function clip(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

export async function ingestGeneration(input: IngestGenerationInput): Promise<boolean> {
  const createdAt = input.createdAt ?? Date.now();

  const userNode = graphId(nodeKey.user(input.userId));
  const projectNode = graphId(nodeKey.project(input.projectId));
  const sessionNode = graphId(nodeKey.session(input.sessionId));
  const generationNode = graphId(nodeKey.generation(input.versionId));

  const fingerprint = themeFingerprint(input.theme);
  const themeNode = graphId(nodeKey.theme(fingerprint));

  const codeGraph = buildCodeGraph(input.pageType, input.files);
  const componentNodes = new Map(
    codeGraph.map((component) => [
      component.path,
      graphId(nodeKey.component(input.projectId, input.pageType, component.path)),
    ]),
  );

  const concepts = extractConcepts(
    [input.prompt, input.meta.name, input.meta.summary].filter((part) => part.trim().length > 0).join(" "),
  );

  /* ─────────────────────────────── nodes ─────────────────────────────── */

  const statements = [
    upsertNodes(LABEL.user, ["updated_at"], [{ id: userNode, updated_at: createdAt }]),

    // `project_id` carries the Postgres uuid: a node id is a one-way hash, so
    // without it a recalled project could not be linked back to its row.
    upsertNodes(
      LABEL.project,
      ["project_id", "name", "updated_at", "summary"],
      [
        {
          id: projectNode,
          project_id: input.projectId,
          name: clip(input.projectName, 120),
          updated_at: createdAt,
          summary: clip(input.meta.summary, 400),
        },
      ],
    ),

    upsertNodes(
      LABEL.session,
      ["started_at", "updated_at"],
      [{ id: sessionNode, started_at: createdAt, updated_at: createdAt }],
    ),

    upsertNodes(
      LABEL.generation,
      ["page_type", "prompt", "mode", "created_at", "name", "summary", "version_id", "file_count"],
      [
        {
          id: generationNode,
          page_type: input.pageType,
          prompt: clip(input.prompt, 1_000),
          mode: input.mode,
          created_at: createdAt,
          name: clip(input.meta.name, 120),
          summary: clip(input.meta.summary, 400),
          version_id: input.versionId,
          file_count: Object.keys(input.files).length,
        },
      ],
    ),

    upsertNodes(
      LABEL.theme,
      ["fingerprint", "primary", "secondary", "accent", "background", "foreground", "heading_font", "body_font", "radius"],
      [
        {
          id: themeNode,
          fingerprint,
          primary: input.theme.colors.primary,
          secondary: input.theme.colors.secondary ?? "",
          accent: input.theme.colors.accent ?? "",
          background: input.theme.colors.background ?? "",
          foreground: input.theme.colors.foreground ?? "",
          heading_font: input.theme.fonts.heading,
          body_font: input.theme.fonts.body,
          radius: input.theme.radius ?? "",
        },
      ],
    ),

    // `project_id` and `page_type` together make the component set of one page
    // reachable in a single hop-free match, which the refinement path needs
    // before it can start traversing IMPORTS.
    upsertNodes(
      LABEL.component,
      [
        "project_id",
        "path",
        "name",
        "purpose",
        "page_type",
        "is_entry",
        "is_client",
        "line_count",
        "size",
        "updated_at",
      ],
      codeGraph.map<NodeRow>((component) => ({
        id: componentNodes.get(component.path) ?? 0,
        project_id: input.projectId,
        path: component.path,
        name: component.name,
        purpose: clip(component.purpose, 200),
        page_type: input.pageType,
        is_entry: component.isEntry,
        is_client: component.isClient,
        line_count: component.lineCount,
        size: component.size,
        updated_at: createdAt,
      })),
    ),

    upsertNodes(
      LABEL.concept,
      ["name", "weight"],
      concepts.map<NodeRow>((concept) => ({
        id: graphId(nodeKey.concept(input.userId, concept.key)),
        name: concept.label,
        weight: concept.weight,
      })),
    ),
  ];

  /* ───────────────────────────── relationships ───────────────────────── */

  statements.push(
    upsertEdges(REL.owns, LABEL.user, LABEL.project, [
      { id: edgeId(REL.owns, userNode, projectNode), src: userNode, dst: projectNode },
    ]),

    upsertEdges(REL.hasSession, LABEL.project, LABEL.session, [
      { id: edgeId(REL.hasSession, projectNode, sessionNode), src: projectNode, dst: sessionNode },
    ]),

    // Both the project and the session point at the generation. HydraDB's batch
    // reads are one hop, so the direct project edge keeps the common lookup —
    // "the newest landing page of this project" — from needing a join.
    upsertEdges(
      REL.hasGeneration,
      LABEL.project,
      LABEL.generation,
      [
        {
          id: edgeId(REL.hasGeneration, projectNode, generationNode),
          src: projectNode,
          dst: generationNode,
          created_at: createdAt,
          page_type: input.pageType,
        },
      ],
      ["created_at", "page_type"],
    ),

    upsertEdges(REL.hasGeneration, LABEL.session, LABEL.generation, [
      { id: edgeId(REL.hasGeneration, sessionNode, generationNode), src: sessionNode, dst: generationNode },
    ]),

    upsertEdges(REL.usesTheme, LABEL.generation, LABEL.theme, [
      { id: edgeId(REL.usesTheme, generationNode, themeNode), src: generationNode, dst: themeNode },
    ]),

    upsertEdges(
      REL.produced,
      LABEL.generation,
      LABEL.component,
      codeGraph.map<EdgeRow>((component) => {
        const target = componentNodes.get(component.path) ?? 0;
        return {
          id: edgeId(REL.produced, generationNode, target),
          src: generationNode,
          dst: target,
        };
      }),
    ),

    upsertEdges(
      REL.imports,
      LABEL.component,
      LABEL.component,
      codeGraph.flatMap<EdgeRow>((component) => {
        const source = componentNodes.get(component.path) ?? 0;
        return component.imports.flatMap((importPath) => {
          const target = componentNodes.get(importPath);
          if (target === undefined) return [];
          return [{ id: edgeId(REL.imports, source, target), src: source, dst: target }];
        });
      }),
    ),

    upsertEdges(
      REL.mentions,
      LABEL.project,
      LABEL.concept,
      concepts.map<EdgeRow>((concept) => {
        const target = graphId(nodeKey.concept(input.userId, concept.key));
        return { id: edgeId(REL.mentions, projectNode, target), src: projectNode, dst: target };
      }),
    ),

    // The reverse edge is not redundant: batch fan-in can only walk forward from
    // the ids it is given, so "which projects mention these concepts" needs it.
    upsertEdges(
      REL.mentionedBy,
      LABEL.concept,
      LABEL.project,
      concepts.map<EdgeRow>((concept) => {
        const source = graphId(nodeKey.concept(input.userId, concept.key));
        return { id: edgeId(REL.mentionedBy, source, projectNode), src: source, dst: projectNode };
      }),
    ),
  );

  if (input.previousVersionId) {
    const previous = graphId(nodeKey.generation(input.previousVersionId));
    statements.push(
      upsertEdges(REL.follows, LABEL.generation, LABEL.generation, [
        { id: edgeId(REL.follows, generationNode, previous), src: generationNode, dst: previous },
      ]),
    );
  }

  if (input.derivedFromVersionId) {
    const origin = graphId(nodeKey.generation(input.derivedFromVersionId));
    statements.push(
      upsertEdges(
        REL.derivedFrom,
        LABEL.generation,
        LABEL.generation,
        [
          {
            id: edgeId(REL.derivedFrom, generationNode, origin),
            src: generationNode,
            dst: origin,
            reason: "inherited design system",
          },
        ],
        ["reason"],
      ),
    );
  }

  return hydraWriteBatch(statements);
}
