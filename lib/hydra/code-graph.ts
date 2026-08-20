import { getFramework } from "@/lib/framework";
import type { FileMap, PageType } from "@/lib/types";

/**
 * Reads a generated tree as a graph of components rather than a bag of files.
 *
 * This is what lets a refinement send Claude the three files a change actually
 * touches instead of all eight. The entry file imports the sections, the
 * sections import each other, and walking those edges from a starting point
 * gives a context set that is both small and complete — where "complete" means
 * nothing referenced by what we sent is missing, which similarity ranking over
 * file contents cannot promise.
 */

export interface ComponentNode {
  /** Project-relative POSIX path, e.g. `components/Hero.tsx`. */
  path: string;
  /** Default-exported component name, e.g. `Hero`. */
  name: string;
  /** One line on what the slot is for, from the page framework. */
  purpose: string;
  /** Paths this file imports from within the project. */
  imports: string[];
  isEntry: boolean;
  isClient: boolean;
  lineCount: number;
  /** Characters, so context budgeting can be done without the contents. */
  size: number;
}

/** `@/components/Hero` and `./Hero` both resolve to `components/Hero.tsx`. */
function resolveImport(specifier: string, fromPath: string): string | null {
  if (specifier.startsWith("@/")) return withExtension(specifier.slice(2));

  if (specifier.startsWith(".")) {
    const fromDir = fromPath.split("/").slice(0, -1);
    const segments = specifier.split("/");
    const resolved: string[] = [...fromDir];

    for (const segment of segments) {
      if (segment === "." || segment === "") continue;
      if (segment === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(segment);
    }

    return withExtension(resolved.join("/"));
  }

  // A bare specifier is a package (react, next/image) — not part of this graph.
  return null;
}

function withExtension(path: string): string {
  return /\.[a-z]+$/i.test(path) ? path : `${path}.tsx`;
}

const IMPORT_PATTERN = /import\s+(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g;

function parseImports(source: string, fromPath: string): string[] {
  const found = new Set<string>();

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (!specifier) continue;
    const resolved = resolveImport(specifier, fromPath);
    if (resolved) found.add(resolved);
  }

  return [...found];
}

function componentName(path: string, source: string): string {
  const declared = /export\s+default\s+function\s+([A-Za-z0-9_]+)/.exec(source);
  if (declared?.[1]) return declared[1];

  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[a-z]+$/i, "");
}

/** Builds the component graph for one generated tree. */
export function buildCodeGraph(pageType: PageType, files: FileMap): ComponentNode[] {
  const framework = getFramework(pageType);
  const purposes = new Map(framework.components.map((component) => [component.path, component.purpose]));

  return Object.keys(files)
    .filter((path) => /\.(tsx|ts|jsx|js)$/i.test(path))
    .sort()
    .map((path) => {
      const source = files[path] ?? "";
      // Imports of files that were never generated would be dangling edges.
      const imports = parseImports(source, path).filter((target) => files[target] !== undefined);

      return {
        path,
        name: componentName(path, source),
        purpose: purposes.get(path) ?? (path === framework.entryFile ? "Composes the page." : ""),
        imports,
        isEntry: path === framework.entryFile,
        isClient: /^\s*["']use client["']/.test(source),
        lineCount: source.split("\n").length,
        size: source.length,
      };
    });
}

/**
 * Walks IMPORTS outward from the components a request names, and returns the
 * paths worth sending.
 *
 * The entry file is always included — it is what composes everything, so a
 * change to a section is usually visible there — and the walk is depth-bounded
 * because a generated tree is shallow and an unbounded one would just re-select
 * the whole project.
 */
export function selectRelevantPaths({
  graph,
  seeds,
  maxDepth = 2,
  maxPaths = 6,
}: {
  graph: readonly ComponentNode[];
  seeds: readonly string[];
  maxDepth?: number;
  maxPaths?: number;
}): string[] {
  const byPath = new Map(graph.map((node) => [node.path, node]));
  const selected = new Set<string>();

  const entry = graph.find((node) => node.isEntry);
  if (entry) selected.add(entry.path);

  let frontier = seeds.filter((path) => byPath.has(path));
  for (const path of frontier) selected.add(path);

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const target of byPath.get(path)?.imports ?? []) {
        if (selected.has(target)) continue;
        selected.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }

  return [...selected].slice(0, maxPaths);
}

/**
 * Matches an instruction against component names and purposes to decide where
 * the traversal should start. "Make the hero bigger" seeds `components/Hero.tsx`.
 */
export function seedsForInstruction(instruction: string, graph: readonly ComponentNode[]): string[] {
  const lowered = instruction.toLowerCase();

  return graph
    .filter((node) => {
      if (node.isEntry) return false;
      if (lowered.includes(node.name.toLowerCase())) return true;
      return node.purpose
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((word) => word.length > 4)
        .some((word) => lowered.includes(word));
    })
    .map((node) => node.path);
}
