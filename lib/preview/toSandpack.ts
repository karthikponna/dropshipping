/**
 * Canonical Next.js tree → runnable Sandpack project.
 *
 * Sandpack cannot run a Next.js server, so the preview is a `vite-react-ts`
 * sandbox that renders the same components. The canonical tree the model emits
 * (and that we store and export) is never mutated: this module produces a
 * separate, throwaway file tree for the bundler.
 *
 * What it does, in order:
 *   1. normalises and filters the incoming FileMap (only `app/page.tsx` from
 *      `app/`, since the rest of the App Router is server plumbing),
 *   2. drops `"use client"` / `"use server"` directives,
 *   3. rewrites module specifiers only — `@/x` to a relative path, `next/image`
 *      and friends to the shim modules in ./shims — never JSX call sites,
 *   4. stubs anything an import asks for but the tree does not have yet, so a
 *      half-streamed generation renders skeletons instead of syntax errors,
 *   5. wraps `app/page.tsx` as the sandbox root `App.tsx` and writes an
 *      `index.html` carrying the Tailwind Play CDN configured from the theme.
 *
 * It is called on every stream tick, so it never throws: any unexpected failure
 * degrades to a placeholder project (see `isPlaceholder`).
 */

import type { FileMap, Theme } from "@/lib/types";
import { normalizeTheme } from "@/lib/types";

import {
  NEXT_FONT_SHIM,
  NEXT_FONT_SPECIFIERS,
  NEXT_MODULE_SHIMS,
  PLACEHOLDER_PAGE_SOURCE,
  PREVIEW_NAVIGATION_MODULE,
  SANDBOX_PACKAGES,
  SHIM_DIR,
  SHIM_FILES,
  createPackageStubSource,
  createSkeletonModuleSource,
  toIdentifier,
} from "./shims";

/* ──────────────────────────────── contract ──────────────────────────────── */

/**
 * The Sandpack template the preview runs on.
 *
 * `vite-react-ts` runs on Sandpack's node environment (Nodebox), which is what
 * makes a real `index.html` — and therefore the Tailwind Play CDN plus the
 * theme's font links — a first-class part of the sandbox. The cost is boot
 * latency: Nodebox installs the template's dependencies in the browser. The
 * panel hides that by mounting the sandbox as soon as a generation starts,
 * rather than waiting for the first file to land.
 */
export const SANDPACK_TEMPLATE = "vite-react-ts" as const;

/** Path of the entry file in the canonical (Next.js) tree. */
export const CANONICAL_ENTRY = "app/page.tsx";

/** Sandbox path React mounts. `App.tsx` re-exports the canonical page. */
export const SANDPACK_ROOT = "/App.tsx";

export interface ToSandpackInput {
  /** The canonical Next.js tree. Partial, empty, or malformed input is fine. */
  files?: FileMap | null;
  /**
   * Theme from the `<theme>` block. Anything unparseable falls back to
   * `DEFAULT_THEME`; when omitted, a `theme.json` inside `files` is used.
   */
  theme?: unknown;
  /** Shop name, used for the preview document title. */
  title?: string;
}

export interface SandpackProject {
  /** Sandpack file map: absolute sandbox paths (`"/App.tsx"`) to contents. */
  files: Record<string, string>;
  template: typeof SANDPACK_TEMPLATE;
  /** Sandbox entry module. */
  entry: string;
  /** File Sandpack should treat as active. */
  activeFile: string;
  /** Generated files worth showing in a Sandpack file tree, in a stable order. */
  visibleFiles: string[];
  /** True when no usable page arrived and the placeholder is being rendered. */
  isPlaceholder: boolean;
  /** Sandbox paths that were filled in with a skeleton or stub. */
  stubbedPaths: string[];
  /** Non-fatal notes: skipped files, dropped imports, stubbed packages. */
  warnings: string[];
  /**
   * Cheap content hash. Two projects with the same fingerprint are byte-for-byte
   * identical, which lets the preview panel skip Sandpack updates while
   * streaming without deep-comparing every file.
   */
  fingerprint: string;
}

/* ──────────────────────────────── entry point ───────────────────────────── */

/**
 * Total by construction: every failure path returns a renderable project.
 */
export function toSandpack(input: ToSandpackInput = {}): SandpackProject {
  try {
    return build(input);
  } catch (error) {
    return placeholderProject([
      `adapter failed, showing placeholder: ${errorMessage(error)}`,
    ]);
  }
}

/* ──────────────────────────────── the build ─────────────────────────────── */

function build(input: ToSandpackInput): SandpackProject {
  const warnings: string[] = [];
  const source = normalizeFileMap(input.files);
  const theme = resolveTheme(input.theme, source["theme.json"]);
  const title = cleanTitle(input.title);

  const usable = new Map<string, string>();
  const stubbedPaths: string[] = [];

  for (const [path, code] of Object.entries(source)) {
    if (!isPreviewablePath(path)) continue;
    if (path.startsWith("app/") && path !== CANONICAL_ENTRY) {
      warnings.push(`skipped ${path}: only ${CANONICAL_ENTRY} is rendered in the preview`);
      continue;
    }
    if (isStyleSheet(path)) {
      usable.set(path, code);
      continue;
    }
    if (!looksComplete(code, path === CANONICAL_ENTRY)) {
      warnings.push(`${path} looks unfinished, using a placeholder for now`);
      continue;
    }
    usable.set(path, code);
  }

  const present = new Set(usable.keys());
  for (const shimPath of Object.keys(SHIM_FILES)) present.add(shimPath);

  const files: Record<string, string> = {};
  const requests: ModuleRequest[] = [];

  for (const [path, code] of usable) {
    if (isStyleSheet(path)) {
      files[sandboxPath(path)] = code;
      continue;
    }
    const transformed = transformModule(path, code);
    files[sandboxPath(path)] = transformed.code;
    requests.push(...transformed.requests);
    warnings.push(...transformed.warnings);
  }

  const isPlaceholder = !usable.has(CANONICAL_ENTRY);
  if (isPlaceholder) {
    files[sandboxPath(CANONICAL_ENTRY)] = PLACEHOLDER_PAGE_SOURCE;
    stubbedPaths.push(sandboxPath(CANONICAL_ENTRY));
    present.add(CANONICAL_ENTRY);
  }

  for (const [path, code] of Object.entries(SHIM_FILES)) {
    files[sandboxPath(path)] = code;
  }

  for (const stub of resolveStubs(requests, present, warnings)) {
    files[sandboxPath(stub.path)] = stub.code;
    stubbedPaths.push(sandboxPath(stub.path));
    present.add(stub.path);
  }

  files[SANDPACK_ROOT] = ROOT_APP_SOURCE;
  files["/index.tsx"] = ROOT_INDEX_SOURCE;
  files["/index.html"] = buildIndexHtml(theme, title);
  files["/styles.css"] = buildStyleSheet(theme);

  return {
    files,
    template: SANDPACK_TEMPLATE,
    entry: SANDPACK_ROOT,
    activeFile: SANDPACK_ROOT,
    visibleFiles: orderVisibleFiles(files),
    isPlaceholder,
    stubbedPaths,
    warnings,
    fingerprint: fingerprintOf(files),
  };
}

function placeholderProject(warnings: string[]): SandpackProject {
  const theme = normalizeTheme(undefined);
  const files: Record<string, string> = {
    [sandboxPath(CANONICAL_ENTRY)]: PLACEHOLDER_PAGE_SOURCE,
    [SANDPACK_ROOT]: ROOT_APP_SOURCE,
    "/index.tsx": ROOT_INDEX_SOURCE,
    "/index.html": buildIndexHtml(theme, ""),
    "/styles.css": buildStyleSheet(theme),
  };
  for (const [path, code] of Object.entries(SHIM_FILES)) {
    files[sandboxPath(path)] = code;
  }
  return {
    files,
    template: SANDPACK_TEMPLATE,
    entry: SANDPACK_ROOT,
    activeFile: SANDPACK_ROOT,
    visibleFiles: orderVisibleFiles(files),
    isPlaceholder: true,
    stubbedPaths: [sandboxPath(CANONICAL_ENTRY)],
    warnings,
    fingerprint: fingerprintOf(files),
  };
}

const ROOT_APP_SOURCE = `import Page from "./app/page";

export default function App() {
  return <Page />;
}
`;

const ROOT_INDEX_SOURCE = `import { createRoot } from "react-dom/client";

import App from "./App";
import installPreviewNavigation from "./${PREVIEW_NAVIGATION_MODULE}";
import "./styles.css";

// The sandbox renders one route; a click on a link to the other one is reported
// out to the panel, which switches the tree being previewed.
installPreviewNavigation();

const container = document.getElementById("root");

if (container) {
  createRoot(container).render(<App />);
}
`;

/* ─────────────────────────────── file plumbing ──────────────────────────── */

/** Trims, de-duplicates and canonicalises the keys of a model-supplied map. */
function normalizeFileMap(files: FileMap | null | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (typeof files !== "object" || files === null) return normalized;

  for (const [rawPath, rawCode] of Object.entries(files)) {
    if (typeof rawPath !== "string" || typeof rawCode !== "string") continue;
    const path = canonicalPath(rawPath);
    if (path.length === 0) continue;
    normalized[path] = rawCode;
  }
  return normalized;
}

function canonicalPath(rawPath: string): string {
  const cleaned = rawPath.trim().replace(/\\/g, "/");
  const segments: string[] = [];

  for (const segment of cleaned.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
}

function sandboxPath(path: string): string {
  return `/${canonicalPath(path)}`;
}

const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"] as const;

function isCodeFile(path: string): boolean {
  return !path.endsWith(".d.ts") && CODE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isStyleSheet(path: string): boolean {
  return path.endsWith(".css");
}

function isPreviewablePath(path: string): boolean {
  if (path.includes("node_modules/")) return false;
  return isCodeFile(path) || isStyleSheet(path);
}

/**
 * Heuristic completeness check for a streamed file. Cheap and deliberately
 * conservative: a false negative only costs one tick of skeleton, while a false
 * positive hands the bundler a syntax error.
 */
function looksComplete(code: string, requireDefaultExport: boolean): boolean {
  const trimmed = code.trim();
  if (trimmed.length < 24) return false;
  if (requireDefaultExport && !/export\s+default\b/.test(trimmed)) return false;
  if (!/export\s+(default|const|function|class|async|{|\*)/.test(trimmed)) return false;
  if (countOf(trimmed, "{") !== countOf(trimmed, "}")) return false;
  if (countOf(trimmed, "(") !== countOf(trimmed, ")")) return false;
  if (countOf(trimmed, "`") % 2 !== 0) return false;
  return /[});\]]$/.test(trimmed);
}

function countOf(value: string, character: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === character) total += 1;
  }
  return total;
}

/* ───────────────────────────── module rewriting ─────────────────────────── */

interface ModuleRequest {
  /** Canonical path (no leading slash) the import needs to resolve to. */
  path: string;
  /** Original specifier, for warnings and stub headers. */
  specifier: string;
  kind: "local" | "package" | "style";
  bindings: ImportBindings;
  typeOnly: boolean;
}

interface ImportBindings {
  defaultName?: string;
  namespaceName?: string;
  named: string[];
}

interface TransformedModule {
  code: string;
  requests: ModuleRequest[];
  warnings: string[];
}

const DIRECTIVE_RE = /^[ \t]*(['"])use (?:client|server|strict)\1[ \t]*;?[ \t]*$/gm;
const FROM_IMPORT_RE = /^([ \t]*)(import|export)\b([^'"`;]*?)\bfrom[ \t\r\n]*(['"])([^'"\n]+)\4[ \t]*;?/gm;
const SIDE_EFFECT_IMPORT_RE = /^([ \t]*)import[ \t]+(['"])([^'"\n]+)\2[ \t]*;?/gm;
const DYNAMIC_IMPORT_RE = /\bimport\([ \t]*(['"])([^'"\n]+)\1[ \t]*\)/g;

function transformModule(path: string, code: string): TransformedModule {
  const requests: ModuleRequest[] = [];
  const warnings: string[] = [];
  const dir = dirnameOf(path);
  let fontImportCount = 0;

  let output = code.replace(DIRECTIVE_RE, "");

  output = output.replace(
    FROM_IMPORT_RE,
    (_match, indent: string, keyword: string, clause: string, quote: string, specifier: string) => {
      const bindings = parseBindings(clause);
      const typeOnly = /^[ \t]*type[ \t]/.test(clause);

      if (NEXT_FONT_SPECIFIERS.includes(specifier)) {
        const alias = `__nextFont${fontImportCount}`;
        fontImportCount += 1;
        return `${indent}${renderFontShim(dir, alias, bindings)}`;
      }

      const rewritten = rewriteSpecifier({
        dir,
        specifier,
        bindings,
        typeOnly,
        requests,
        warnings,
      });

      if (rewritten === null) {
        warnings.push(`dropped "${specifier}" from ${path}: no browser equivalent`);
        return "";
      }

      return `${indent}${keyword}${clause}from ${quote}${rewritten}${quote};`;
    },
  );

  output = output.replace(
    SIDE_EFFECT_IMPORT_RE,
    (_match, indent: string, quote: string, specifier: string) => {
      const rewritten = rewriteSpecifier({
        dir,
        specifier,
        bindings: { named: [] },
        typeOnly: false,
        requests,
        warnings,
      });
      if (rewritten === null) return "";
      return `${indent}import ${quote}${rewritten}${quote};`;
    },
  );

  output = output.replace(DYNAMIC_IMPORT_RE, (_match, quote: string, specifier: string) => {
    const rewritten = rewriteSpecifier({
      dir,
      specifier,
      bindings: { named: [] },
      typeOnly: false,
      requests,
      warnings,
    });
    if (rewritten === null) return "Promise.resolve({ default: () => null })";
    return `import(${quote}${rewritten}${quote})`;
  });

  return { code: `${output.replace(/^\s*\n/, "").trimEnd()}\n`, requests, warnings };
}

interface RewriteContext {
  dir: string;
  specifier: string;
  bindings: ImportBindings;
  typeOnly: boolean;
  requests: ModuleRequest[];
  warnings: string[];
}

/**
 * Returns the specifier to emit, or `null` when the import should be dropped.
 * Records what the sandbox has to contain for the rewritten specifier to
 * resolve, so missing modules can be stubbed afterwards.
 */
function rewriteSpecifier(context: RewriteContext): string | null {
  const { dir, specifier, bindings, typeOnly, requests } = context;

  const shim = NEXT_MODULE_SHIMS[specifier];
  if (shim) return relativeSpecifier(dir, stripCodeExtension(shim));

  if (specifier === "next" || specifier.startsWith("next/") || specifier.startsWith("@next/")) {
    return null;
  }

  if (isAliasSpecifier(specifier)) {
    const target = canonicalPath(specifier.replace(/^[@~]\//, ""));
    requests.push({
      path: target,
      specifier,
      kind: isStyleSheet(target) ? "style" : "local",
      bindings,
      typeOnly,
    });
    return relativeSpecifier(dir, stripCodeExtension(target));
  }

  if (specifier.startsWith(".")) {
    const target = joinPath(dir, specifier);
    requests.push({
      path: target,
      specifier,
      kind: isStyleSheet(target) ? "style" : "local",
      bindings,
      typeOnly,
    });
    return isStyleSheet(target) ? relativeSpecifier(dir, target) : relativeSpecifier(dir, stripCodeExtension(target));
  }

  if (SANDBOX_PACKAGES.includes(specifier)) return specifier;

  // Any other bare package is not installed in the sandbox. Point it at a stub
  // exporting exactly the requested bindings rather than letting the bundler
  // fail on an unresolved module.
  const stubPath = `${SHIM_DIR}/packages/${slugify(specifier)}.tsx`;
  requests.push({ path: stubPath, specifier, kind: "package", bindings, typeOnly });
  context.warnings.push(`stubbed package "${specifier}": unavailable in the preview sandbox`);
  return relativeSpecifier(dir, stripCodeExtension(stubPath));
}

function renderFontShim(dir: string, alias: string, bindings: ImportBindings): string {
  const target = relativeSpecifier(dir, stripCodeExtension(NEXT_FONT_SHIM));
  const lines = [`import ${alias} from "${target}";`];
  const names = bindings.named.map((name) => toIdentifier(name, "font"));

  if (names.length > 0) {
    lines.push(`const { ${names.join(", ")} } = ${alias};`);
  }
  if (bindings.defaultName) {
    const name = toIdentifier(bindings.defaultName, "localFont");
    lines.push(`const ${name} = ${alias}.${name};`);
  }
  if (bindings.namespaceName) {
    const name = toIdentifier(bindings.namespaceName, "fonts");
    lines.push(`const ${name} = ${alias};`);
  }
  return lines.join("\n");
}

function isAliasSpecifier(specifier: string): boolean {
  return specifier.startsWith("@/") || specifier.startsWith("~/");
}

function parseBindings(clause: string): ImportBindings {
  const trimmed = clause.trim().replace(/^type[ \t]+/, "");
  const braces = /\{([\s\S]*)\}/.exec(trimmed);
  const head = (braces ? trimmed.slice(0, braces.index) : trimmed).replace(/,\s*$/, "").trim();

  const bindings: ImportBindings = { named: [] };

  const namespace = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(head);
  if (namespace) {
    bindings.namespaceName = namespace[1];
  } else {
    const defaultName = /^([A-Za-z_$][\w$]*)$/.exec(head);
    if (defaultName) bindings.defaultName = defaultName[1];
  }

  if (braces) {
    for (const part of braces[1].split(",")) {
      const name = part.trim().replace(/^type[ \t]+/, "");
      if (name.length === 0) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*$/.exec(name);
      const resolved = aliased ? aliased[1] : name;
      if (/^[A-Za-z_$][\w$]*$/.test(resolved) && resolved !== "default") {
        bindings.named.push(resolved);
      } else if (resolved === "default") {
        bindings.defaultName ??= "Default";
      }
    }
  }

  return bindings;
}

/* ─────────────────────────────── stub filling ───────────────────────────── */

interface GeneratedStub {
  path: string;
  code: string;
}

function resolveStubs(
  requests: readonly ModuleRequest[],
  present: Set<string>,
  warnings: string[],
): GeneratedStub[] {
  const stubs = new Map<string, GeneratedStub>();
  const merged = new Map<string, ModuleRequest[]>();

  for (const request of requests) {
    if (resolvesTo(request.path, present)) continue;
    if (request.typeOnly) continue;
    const list = merged.get(request.path) ?? [];
    list.push(request);
    merged.set(request.path, list);
  }

  for (const [path, group] of merged) {
    const first = group[0];

    if (first.kind === "style" || isStyleSheet(path)) {
      stubs.set(path, { path, code: `/* ${path} was not generated. */\n` });
      continue;
    }

    const named = group.flatMap((request) => request.bindings.named);
    const defaultName = group.find((request) => request.bindings.defaultName)?.bindings.defaultName;
    const namespaceName = group.find((request) => request.bindings.namespaceName)?.bindings.namespaceName;

    if (first.kind === "package") {
      stubs.set(path, {
        path,
        code: createPackageStubSource({
          specifier: first.specifier,
          defaultName,
          namedNames: named,
          namespaceName,
        }),
      });
      continue;
    }

    const stubPath = path.endsWith(".tsx") ? path : `${path}.tsx`;
    warnings.push(`${path} was imported but has not arrived, rendering a skeleton`);
    stubs.set(stubPath, {
      path: stubPath,
      code: createSkeletonModuleSource({
        name: componentNameFor(path),
        namedExports: named,
        withDefault: Boolean(defaultName) || Boolean(namespaceName) || named.length === 0,
      }),
    });
  }

  return Array.from(stubs.values());
}

/** Does `target` (usually extension-less) match something already in the tree? */
function resolvesTo(target: string, present: Set<string>): boolean {
  if (present.has(target)) return true;
  for (const ext of CODE_EXTENSIONS) {
    if (present.has(`${target}${ext}`)) return true;
    if (present.has(`${target}/index${ext}`)) return true;
  }
  return false;
}

function componentNameFor(path: string): string {
  const base = path.split("/").pop() ?? "Section";
  const stem = base.replace(/\.[^.]+$/, "");
  const pascal = stem
    .split(/[^A-Za-z0-9]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return toIdentifier(pascal.length > 0 ? pascal : "Section", "Section");
}

/* ───────────────────────────────── paths ────────────────────────────────── */

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function joinPath(dir: string, specifier: string): string {
  const parts = dir.length > 0 ? dir.split("/") : [];
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function relativeSpecifier(fromDir: string, target: string): string {
  const fromParts = fromDir.length > 0 ? fromDir.split("/") : [];
  const targetParts = target.split("/");

  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < targetParts.length - 1 &&
    fromParts[shared] === targetParts[shared]
  ) {
    shared += 1;
  }

  const up = fromParts.length - shared;
  const rest = targetParts.slice(shared);
  if (up === 0) return `./${rest.join("/")}`;
  return [...new Array<string>(up).fill(".."), ...rest].join("/");
}

function stripCodeExtension(path: string): string {
  for (const ext of CODE_EXTENSIONS) {
    if (path.endsWith(ext)) return path.slice(0, -ext.length);
  }
  return path;
}

function slugify(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug.length > 0 ? slug : "module";
}

/* ────────────────────────────── html and theme ──────────────────────────── */

function resolveTheme(theme: unknown, themeFile: string | undefined): Theme {
  if (theme !== undefined && theme !== null) return normalizeTheme(theme);
  if (typeof themeFile === "string" && themeFile.trim().length > 0) {
    try {
      return normalizeTheme(JSON.parse(themeFile));
    } catch {
      return normalizeTheme(undefined);
    }
  }
  return normalizeTheme(undefined);
}

const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9a-z.,%/\s]+\)|[a-z]{3,20})$/i;
const SAFE_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,39}$/;
const SAFE_LENGTH_RE = /^[0-9]*\.?[0-9]+(px|rem|em|%)?$/;

function safeColor(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return SAFE_COLOR_RE.test(trimmed) ? trimmed : fallback;
}

function safeFamily(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return SAFE_FAMILY_RE.test(trimmed) ? trimmed : fallback;
}

function safeLength(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return SAFE_LENGTH_RE.test(trimmed) ? trimmed : fallback;
}

interface PreviewTokens {
  colors: Record<string, string>;
  heading: string;
  body: string;
  mono: string;
  radius: string;
}

function tokensFor(theme: Theme): PreviewTokens {
  return {
    colors: {
      primary: safeColor(theme.colors.primary, "#111111"),
      secondary: safeColor(theme.colors.secondary, "#f5f5f5"),
      accent: safeColor(theme.colors.accent, theme.colors.primary),
      background: safeColor(theme.colors.background, "#ffffff"),
      foreground: safeColor(theme.colors.foreground, "#111111"),
      muted: safeColor(theme.colors.muted, "#737373"),
      border: safeColor(theme.colors.border, "#e5e5e5"),
    },
    heading: safeFamily(theme.fonts.heading, "Inter"),
    body: safeFamily(theme.fonts.body, "Inter"),
    mono: safeFamily(theme.fonts.mono, "IBM Plex Mono"),
    radius: safeLength(theme.radius, "0.5rem"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanTitle(title: string | undefined): string {
  const trimmed = (title ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : "Preview";
}

/**
 * Google Fonts answers 400 for a family that lacks a requested weight, which
 * would take the whole stylesheet down. Each family therefore gets its own
 * link, plus a bare fallback link that can only ever succeed.
 */
function fontLinks(families: readonly string[]): string {
  const unique = Array.from(new Set(families));
  const links: string[] = [
    '<link rel="preconnect" href="https://fonts.googleapis.com" />',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  ];
  for (const family of unique) {
    const param = encodeURIComponent(family).replace(/%20/g, "+");
    links.push(
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${param}:wght@300;400;500;600;700;800&display=swap" />`,
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${param}&display=swap" />`,
    );
  }
  return links.map((link) => `    ${link}`).join("\n");
}

function buildIndexHtml(theme: Theme, title: string): string {
  const tokens = tokensFor(theme);
  const stack = "ui-sans-serif, system-ui, sans-serif";
  const config = {
    theme: {
      extend: {
        colors: tokens.colors,
        fontFamily: {
          sans: [tokens.body, "ui-sans-serif", "system-ui", "sans-serif"],
          body: [tokens.body, "ui-sans-serif", "system-ui", "sans-serif"],
          heading: [tokens.heading, "ui-serif", "Georgia", "serif"],
          display: [tokens.heading, "ui-serif", "Georgia", "serif"],
          serif: [tokens.heading, "ui-serif", "Georgia", "serif"],
          mono: [tokens.mono, "ui-monospace", "monospace"],
        },
        borderRadius: { DEFAULT: tokens.radius },
      },
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(cleanTitle(title))}</title>
${fontLinks([tokens.heading, tokens.body])}
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = ${JSON.stringify(config)};
    </script>
    <style>
      body {
        font-family: "${tokens.body}", ${stack};
        background-color: ${tokens.colors.background};
        color: ${tokens.colors.foreground};
      }
      h1, h2, h3, h4, h5, h6 {
        font-family: "${tokens.heading}", ui-serif, Georgia, serif;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.tsx"></script>
  </body>
</html>
`;
}

/**
 * CSS custom properties for generated code that reaches for `var(--primary)`
 * instead of a Tailwind class.
 */
function buildStyleSheet(theme: Theme): string {
  const tokens = tokensFor(theme);
  const variables = Object.entries(tokens.colors)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");

  return `:root {
${variables}
  --radius: ${tokens.radius};
  --font-heading: "${tokens.heading}", ui-serif, Georgia, serif;
  --font-body: "${tokens.body}", ui-sans-serif, system-ui, sans-serif;
}

html {
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
}

body {
  margin: 0;
}
`;
}

/* ────────────────────────────── bookkeeping ─────────────────────────────── */

const VISIBLE_ORDER = [SANDPACK_ROOT, `/${CANONICAL_ENTRY}`, "/index.html", "/styles.css"];

function orderVisibleFiles(files: Record<string, string>): string[] {
  const paths = Object.keys(files);
  const generated = paths
    .filter((path) => !VISIBLE_ORDER.includes(path) && !path.startsWith(`/${SHIM_DIR}/`))
    .sort();
  return [...VISIBLE_ORDER.filter((path) => path in files), ...generated];
}

/** djb2 over paths and contents, in two lanes to keep collisions unlikely. */
function fingerprintOf(files: Record<string, string>): string {
  let low = 5381;
  let high = 52711;
  let total = 0;

  for (const path of Object.keys(files).sort()) {
    const chunk = `${path}\u0000${files[path]}\u0000`;
    total += chunk.length;
    for (let index = 0; index < chunk.length; index += 1) {
      const code = chunk.charCodeAt(index);
      low = (low * 33) ^ code;
      high = (high * 31) ^ (code + index);
    }
  }

  return `${(low >>> 0).toString(36)}-${(high >>> 0).toString(36)}-${total.toString(36)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
