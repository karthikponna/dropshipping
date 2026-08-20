/**
 * Canonical Next.js tree → a downloadable, self-contained project.
 *
 * The generator only ever emits `app/page.tsx`, `components/*.tsx` and
 * (sometimes) `theme.json`. Everything else a Next.js app needs to boot — the
 * manifest, the TypeScript config, the PostCSS config, the root layout, the
 * stylesheet — is synthesised here, so that unzipping the download and running
 * `npm install && npm run dev` produces a working shop with no DropShipping
 * runtime dependency of any kind.
 *
 * Two rules govern the whole module:
 *
 *   1. Generated files are sacred. A scaffold file is only written when the
 *      incoming tree has nothing at that path, so a model that decided to write
 *      its own `app/layout.tsx` keeps it.
 *   2. Output is deterministic. Keys are emitted in sorted order and the zip
 *      entries carry a fixed timestamp, so the same project exports to the same
 *      bytes every time — which is what makes `buildExportFileTree` testable.
 *
 * `buildExportFileTree` is deliberately free of both React and JSZip: JSZip is
 * imported dynamically inside `buildProjectZipBlob` only, keeping ~100KB off the
 * builder's initial payload and keeping the tree builder importable from a plain
 * node test.
 */

import { PAGE_ROUTES, PAGE_ROUTE_SEGMENTS, pageTypeForHref } from "@/lib/framework/routes";
import type { FileMap, PageType, Theme } from "@/lib/types";
import { PAGE_TYPE_LABELS, THEME_FILE_NAME, normalizeTheme } from "@/lib/types";

/* ──────────────────────────────── contract ──────────────────────────────── */

export interface ExportProjectInput {
  /** The canonical Next.js tree from the generator, for a single-page export. */
  files?: FileMap;
  /**
   * One tree per page type, for a shop that has both. Takes precedence over
   * `files`: the landing page becomes `/` and the product page `/product`.
   */
  pages?: Partial<Record<PageType, FileMap>>;
  theme?: Theme | null;
  pageType?: PageType;
  /** Shop / project name, used for the folder, the package name and the README. */
  name?: string;
  /** One-line description, from `GenerationMeta.summary`. */
  summary?: string;
  /** The prompt that produced the project, recorded in the README. */
  prompt?: string;
}

/**
 * Dependency ranges mirrored from this repo's own package.json, so an exported
 * project is known-good against the same majors the preview was built against.
 * Bump them together with the root manifest.
 */
const DEPENDENCIES: Readonly<Record<string, string>> = {
  next: "^15.5.23",
  react: "^19.2.8",
  "react-dom": "^19.2.8",
};

const DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@tailwindcss/postcss": "^4.3.3",
  "@types/node": "^26.2.0",
  "@types/react": "^19.2.18",
  "@types/react-dom": "^19.2.4",
  tailwindcss: "^4.3.3",
  typescript: "^5.9.3",
};

const ENTRY_PATH = "app/page.tsx";

const DEFAULT_SLUG = "dropshipping-site";

const DEFAULT_NAME = "Untitled shop";

/** Fixed mtime for every zip entry. Real timestamps would defeat determinism. */
const ZIP_ENTRY_DATE = new Date("2024-01-01T00:00:00.000Z");

/* ─────────────────────────────── entry points ───────────────────────────── */

/**
 * The complete tree that gets zipped: every usable generated file, plus the
 * scaffold needed to boot it. Pure, total and deterministic.
 */
export function buildExportFileTree(input: ExportProjectInput): FileMap {
  const { generated, pageTypes, shared } = resolveTrees(input);
  const theme = normalizeTheme(input.theme ?? parseThemeFile(generated[THEME_FILE_NAME]));
  const tokens = tokensFor(theme);

  const name = cleanLine(input.name, 80) || DEFAULT_NAME;
  const summary = cleanLine(input.summary, 200);
  const pageType: PageType = pageTypes[0] ?? (input.pageType === "product" ? "product" : "landing");
  const slug = exportProjectSlug(name);

  const merged: FileMap = { ...generated };
  const write = (path: string, contents: string): void => {
    if (path in merged) return;
    merged[path] = contents;
  };

  write(ENTRY_PATH, fallbackPageSource(name, summary));

  // Every call to action on a landing page points at /product, so exporting a
  // shop whose product page has not been built yet would ship its main
  // conversion path as a 404. A holding route keeps those links honest, and
  // disappears the moment the real page exists — `write` never overwrites.
  const pending = pendingRoutes(pageTypes);
  for (const route of pending) {
    write(`app/${SECONDARY_ROUTES[route]}/page.tsx`, pendingRouteSource(name, route));
  }

  write("app/layout.tsx", layoutSource(name, summary, tokens));
  write("app/globals.css", globalsSource(tokens));
  write("package.json", packageJsonSource(slug, summary));
  write("tsconfig.json", TSCONFIG_SOURCE);
  write("next.config.ts", nextConfigSource(remoteImageHosts(generated)));
  write("postcss.config.mjs", POSTCSS_CONFIG_SOURCE);
  write("next-env.d.ts", NEXT_ENV_SOURCE);
  write(".gitignore", GITIGNORE_SOURCE);
  write(THEME_FILE_NAME, `${JSON.stringify(theme, null, 2)}\n`);
  write(
    "README.md",
    readmeSource({
      name,
      summary,
      pageType,
      pageTypes,
      pending,
      shared,
      prompt: input.prompt,
      files: merged,
    }),
  );

  return sortKeys(merged);
}

/* ─────────────────────────── multi-page merging ─────────────────────────── */

/**
 * Route prefix a secondary page is mounted at. The landing page owns `/`
 * because that is what a visitor lands on; anything else gets a segment.
 *
 * Read from `lib/framework/routes.ts` rather than declared here: the prompts
 * tell the model to write `href="/product"`, so the segment the product page
 * lands in is not a free choice.
 */
const SECONDARY_ROUTES: Record<PageType, string> = PAGE_ROUTE_SEGMENTS;

/**
 * Resolves the input into one tree plus the page types it contains.
 *
 * The two page frameworks both emit `app/page.tsx`, `components/Navbar.tsx` and
 * `components/Footer.tsx`, so a shop with both pages cannot simply have its
 * trees merged — one would silently overwrite the other. The secondary page is
 * therefore relocated wholesale into its own route segment and its own component
 * folder, with its imports rewritten to match — except for the chrome the two
 * pages agree on, which is emitted once and imported by both.
 */
function resolveTrees(input: ExportProjectInput): {
  generated: FileMap;
  pageTypes: PageType[];
  shared: string[];
} {
  const supplied: [PageType, FileMap][] = [];

  for (const pageType of ["landing", "product"] as const) {
    const tree = sanitizeFiles(input.pages?.[pageType]);
    if (Object.keys(tree).length > 0) supplied.push([pageType, tree]);
  }

  if (supplied.length === 0) {
    return {
      generated: sanitizeFiles(input.files),
      pageTypes: input.files && Object.keys(input.files).length > 0
        ? [input.pageType === "product" ? "product" : "landing"]
        : [],
      shared: [],
    };
  }

  // A single page always lives at the root, whichever page it is.
  const [firstEntry] = supplied;
  if (supplied.length === 1 && firstEntry) {
    return { generated: firstEntry[1], pageTypes: [firstEntry[0]], shared: [] };
  }

  const primary = supplied.find(([pageType]) => pageType === "landing") ?? firstEntry;
  if (!primary) return { generated: {}, pageTypes: [], shared: [] };

  const generated: FileMap = { ...primary[1] };
  const pageTypes: PageType[] = [primary[0]];
  const shared = new Map<string, string>();

  for (const [pageType, tree] of supplied) {
    if (pageType === primary[0]) continue;
    pageTypes.push(pageType);

    for (const [path, contents] of shareableChrome(
      primary[1],
      tree,
      PAGE_ROUTES[primary[0]],
      PAGE_ROUTES[pageType],
    )) {
      // Replaces the primary's own copy: same component, with the route it is
      // rendered on no longer baked in.
      generated[path] = contents;
      shared.set(path, contents);
    }

    const relocated = relocate(tree, SECONDARY_ROUTES[pageType], new Set(shared.keys()));
    for (const [path, contents] of Object.entries(relocated)) {
      if (path in generated) continue;
      generated[path] = contents;
    }
  }

  return { generated, pageTypes, shared: [...shared.keys()].sort() };
}

/* ──────────────────────────────── shared chrome ─────────────────────────── */

/** Files both page types write at the same path, in the order a page renders them. */
const SHARED_CHROME_PATHS: readonly string[] = ["components/Navbar.tsx", "components/Footer.tsx"];

/** Leading whitespace is captured so a rewritten attribute keeps its indentation. */
const CLASS_NAME_RE = /(\s+)className="([^"]*)"/;
const ARIA_CURRENT_RE = /(\s+)aria-current="([^"]*)"/;
const ROUTE_ANCHOR_SLOT = "\u0000route-anchor\u0000";
const DEFAULT_EXPORT_OPEN = /export default function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/;

/**
 * One copy of the chrome for the whole shop.
 *
 * A product turn now edits the landing page's actual `Navbar.tsx` and
 * `Footer.tsx` rather than being told to write matching ones, so the two copies
 * usually arrive identical — at which point relocating the second one into
 * `components/product/` ships the same component twice in the artifact somebody
 * downloads. Where the pair can be reconciled it is written once at the root and
 * both routes import it from there.
 *
 * The navbar is the one file that differs for a legitimate reason: whichever link
 * points at the route being rendered carries `aria-current` and a heavier style.
 * Picking a copy would mis-mark one of the two routes, so that difference is
 * resolved by deriving the route at runtime instead.
 *
 * Anything differing beyond those attributes falls through to the old
 * de-confliction. A project generated before this contract existed, or a product
 * page refined on its own, has two genuinely different navbars, and dropping
 * either one's work is worse than shipping both.
 */
function shareableChrome(
  primary: FileMap,
  secondary: FileMap,
  primaryRoute: string,
  secondaryRoute: string,
): Map<string, string> {
  const shared = new Map<string, string>();

  for (const path of SHARED_CHROME_PATHS) {
    const ours = primary[path];
    const theirs = secondary[path];
    if (typeof ours !== "string" || typeof theirs !== "string") continue;

    // A sibling importing "./Navbar" would be left pointing at a file that is no
    // longer beside it once the rest of the folder moves.
    const name = chromeName(path);
    if (name === null || importsRelatively(secondary, name) || importsRelatively(primary, name)) {
      continue;
    }

    if (ours === theirs) {
      shared.set(path, ours);
      continue;
    }

    const merged = mergeRouteAwareChrome(ours, theirs, primaryRoute, secondaryRoute);
    if (merged !== null) shared.set(path, merged);
  }

  return shared;
}

/** `components/Navbar.tsx` → `Navbar`. */
function chromeName(path: string): string | null {
  const match = /^components\/([A-Za-z_$][\w$]*)\.tsx$/.exec(path);
  return match?.[1] ?? null;
}

function importsRelatively(files: FileMap, name: string): boolean {
  const pattern = new RegExp(`from\\s*["']\\.{1,2}/${name}["']`);
  return Object.values(files).some((contents) => pattern.test(contents));
}

/** A component split into its links to the shop's own routes and the text between them. */
function splitRouteAnchors(source: string): { template: string; anchors: string[] } {
  const anchors: string[] = [];

  const template = source.replace(/<a\b[^>]*>/g, (tag) => {
    const href = /\shref="([^"]*)"/.exec(tag)?.[1];
    if (href === undefined || pageTypeForHref(href) === null) return tag;
    anchors.push(tag);
    return ROUTE_ANCHOR_SLOT;
  });

  return { template, anchors };
}

/**
 * The two copies reconciled into one component that reads the route it is on,
 * or `null` when they differ by more than which link is current.
 */
function mergeRouteAwareChrome(
  primarySource: string,
  secondarySource: string,
  primaryRoute: string,
  secondaryRoute: string,
): string | null {
  if (primarySource.includes(ROUTE_ANCHOR_SLOT) || secondarySource.includes(ROUTE_ANCHOR_SLOT)) {
    return null;
  }

  const ours = splitRouteAnchors(primarySource);
  const theirs = splitRouteAnchors(secondarySource);

  // A difference anywhere but inside a link to one of the shop's routes is this
  // page's own business, not a per-route difference, so there is nothing to
  // derive and the pair is left alone.
  if (ours.template !== theirs.template || ours.anchors.length !== theirs.anchors.length) {
    return null;
  }

  const resolved: string[] = [];
  let derived = 0;

  for (const [index, tag] of ours.anchors.entries()) {
    const other = theirs.anchors[index];
    if (other === undefined) return null;

    if (tag === other) {
      resolved.push(tag);
      continue;
    }

    // A link's own href says which route it is the current one for, so the copy
    // from that route is the one whose styling means "you are here".
    const route = /\shref="([^"]*)"/.exec(tag)?.[1];
    if (route === undefined || route !== /\shref="([^"]*)"/.exec(other)?.[1]) return null;
    if (route !== primaryRoute && route !== secondaryRoute) return null;

    const active = route === primaryRoute ? tag : other;
    const inactive = route === primaryRoute ? other : tag;

    const merged = mergeAnchorTag(active, inactive, route);
    if (merged === null) return null;

    resolved.push(merged);
    derived += 1;
  }

  if (derived === 0) return null;

  const parts = ours.template.split(ROUTE_ANCHOR_SLOT);
  const body = parts.map((part, index) => `${part}${resolved[index] ?? ""}`).join("");

  return asRouteAwareComponent(body);
}

/** One link, with the attributes that vary by route turned into expressions. */
function mergeAnchorTag(active: string, inactive: string, route: string): string | null {
  // An expression className cannot be compared as text, so there is no way to
  // tell an active style from a difference that matters.
  if (active.includes("className={") || inactive.includes("className={")) return null;

  // Everything the two copies say beyond "you are here" has to agree, or merging
  // would drop half of it.
  if (withoutRouteState(active) !== withoutRouteState(inactive)) return null;

  const condition = `pathname === ${JSON.stringify(route)}`;
  const activeClass = CLASS_NAME_RE.exec(active)?.[2];
  const inactiveClass = CLASS_NAME_RE.exec(inactive)?.[2];
  let tag = active;

  if (activeClass !== inactiveClass) {
    if (activeClass === undefined || inactiveClass === undefined) return null;
    tag = tag.replace(
      CLASS_NAME_RE,
      (_match, space: string) =>
        `${space}className={${condition} ? ${JSON.stringify(activeClass)} : ${JSON.stringify(inactiveClass)}}`,
    );
  }

  const activeAria = ARIA_CURRENT_RE.exec(active)?.[2];
  if (activeAria !== ARIA_CURRENT_RE.exec(inactive)?.[2]) {
    const value = JSON.stringify(activeAria ?? "page");
    tag = ARIA_CURRENT_RE.test(tag)
      ? tag.replace(
          ARIA_CURRENT_RE,
          (_match, space: string) => `${space}aria-current={${condition} ? ${value} : undefined}`,
        )
      : tag.replace(
          /\s*\/?>$/,
          (close) => ` aria-current={${condition} ? ${value} : undefined}${close}`,
        );
  }

  return tag;
}

function withoutRouteState(tag: string): string {
  return tag.replace(CLASS_NAME_RE, " ").replace(ARIA_CURRENT_RE, " ").replace(/\s+/g, " ");
}

/**
 * The merged component, reading its route from the router.
 *
 * `usePathname` rather than a prop: the call sites are model-written JSX in two
 * different `app/page.tsx` files, and rewriting both to pass an argument is more
 * ways to be wrong than synthesising one hook here. The cost is that the chrome
 * becomes a client component, which for a header carrying a cart control is
 * where it was heading anyway.
 */
function asRouteAwareComponent(source: string): string | null {
  const opening = DEFAULT_EXPORT_OPEN.exec(source);
  // Already route-aware, so whatever the two copies disagree about is not this.
  if (!opening || source.includes("usePathname")) return null;

  const bodyStart = opening.index + opening[0].length;
  const withHook = `${source.slice(0, bodyStart)}\n  const pathname = usePathname();\n${source.slice(bodyStart)}`;

  const importLine = 'import { usePathname } from "next/navigation";\n';
  const directive = /^\s*(["'])use client\1;?[ \t]*\r?\n?/.exec(withHook);
  if (directive) {
    const end = directive[0].length;
    return `${withHook.slice(0, end)}\n${importLine}${withHook.slice(end)}`;
  }

  return `"use client";\n\n${importLine}\n${withHook}`;
}

/**
 * Routes this export links to but has no page for.
 *
 * Only ever the secondary routes of a shop that has its landing page: without
 * one, whichever page exists owns `/` and there is nothing pointing elsewhere.
 */
function pendingRoutes(present: readonly PageType[]): PageType[] {
  if (!present.includes("landing")) return [];
  return (Object.keys(SECONDARY_ROUTES) as PageType[])
    .filter((pageType) => pageType !== "landing" && !present.includes(pageType))
    .sort();
}

/** Moves a page's tree under `app/<segment>/` and `components/<segment>/`. */
function relocate(files: FileMap, segment: string, shared: ReadonlySet<string>): FileMap {
  const moved: FileMap = {};
  const sharedNames = new Set([...shared].map(chromeName).filter((name) => name !== null));

  for (const [path, contents] of Object.entries(files)) {
    // The root layout and the theme belong to the project, not to one page.
    if (path === "app/layout.tsx" || path === "app/globals.css" || path === THEME_FILE_NAME) {
      continue;
    }
    // One copy of this already lives at the root, for both routes to import.
    if (shared.has(path)) continue;

    const target = path.startsWith("app/")
      ? `app/${segment}/${path.slice("app/".length)}`
      : path.startsWith("components/")
        ? `components/${segment}/${path.slice("components/".length)}`
        : null;

    if (target === null) continue;
    moved[target] = rewriteComponentImports(contents, segment, sharedNames);
  }

  return moved;
}

/**
 * Repoints `@/components/Hero` at `@/components/product/Hero`, leaving the
 * shared chrome pointing at the root copy.
 *
 * Relative imports need no rewriting: the whole component folder moves
 * together, so `./Hero` still resolves to its neighbour.
 */
function rewriteComponentImports(
  source: string,
  segment: string,
  sharedNames: ReadonlySet<string>,
): string {
  return source.replace(
    /(["'])@\/components\/(?!(?:landing|product)\/)([\w$.-]*)/g,
    (match, quote: string, name: string) =>
      sharedNames.has(name.replace(/\.tsx?$/, ""))
        ? match
        : `${quote}@/components/${segment}/${name}`,
  );
}

/**
 * The same tree, zipped under a single top-level folder so unzipping never
 * scatters files across the user's working directory.
 */
export async function buildProjectZipBlob(input: ExportProjectInput): Promise<Blob> {
  const tree = buildExportFileTree(input);
  const folder = exportProjectSlug(input.name);

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  for (const [path, contents] of Object.entries(tree)) {
    zip.file(`${folder}/${path}`, contents, { date: ZIP_ENTRY_DATE, createFolders: false });
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

/** Slug used for the zip folder and the npm package name. Never empty. */
export function exportProjectSlug(name?: string): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    // Drop the combining marks NFKD just split off, so "Café" slugs to "cafe"
    // rather than "caf-e".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/g, "");
  // A leading digit is legal in an npm name; a leading dot or underscore is not,
  // and the character class above cannot produce either.
  return slug.length > 0 ? slug : DEFAULT_SLUG;
}

/** File name offered to the browser, e.g. `"morning-ritual.zip"`. */
export function exportFileName(name?: string): string {
  return `${exportProjectSlug(name)}.zip`;
}

/* ──────────────────────────── incoming file tree ────────────────────────── */

/**
 * Segments a model is allowed to produce. Wide enough for the App Router's
 * `[id]`, `(group)` and `@slot` conventions, narrow enough to exclude drive
 * letters, control characters and shell metacharacters.
 */
const SAFE_SEGMENT_RE = /^[\w.@()[\]+$ -]+$/;

/**
 * Drops anything that would write outside the export folder. Absolute paths are
 * rejected rather than re-rooted: the parser only ever produces project-relative
 * paths, so a leading slash means the model lost the plot and the file is not
 * worth guessing at.
 */
function sanitizeFiles(files: FileMap | null | undefined): FileMap {
  const result: FileMap = {};
  if (typeof files !== "object" || files === null) return result;

  for (const [rawPath, contents] of Object.entries(files)) {
    if (typeof rawPath !== "string" || typeof contents !== "string") continue;
    const path = sanitizePath(rawPath);
    if (path === null) continue;
    result[path] = contents;
  }
  return result;
}

function sanitizePath(rawPath: string): string | null {
  const cleaned = rawPath.trim().replace(/\\/g, "/");
  if (cleaned.length === 0 || cleaned.startsWith("/")) return null;

  const segments: string[] = [];
  for (const segment of cleaned.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || segment === "node_modules") return null;
    if (!SAFE_SEGMENT_RE.test(segment)) return null;
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join("/") : null;
}

function sortKeys(files: FileMap): FileMap {
  const sorted: FileMap = {};
  for (const path of Object.keys(files).sort()) sorted[path] = files[path];
  return sorted;
}

function parseThemeFile(contents: string | undefined): unknown {
  if (typeof contents !== "string" || contents.trim().length === 0) return undefined;
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}

/* ───────────────────────────── theme sanitising ─────────────────────────── */

/*
 * Theme strings are model output and end up inside CSS declarations, a JSX
 * attribute and a URL, so each is validated against a shape that cannot escape
 * its context: a colour like `red; } html { display: none` and a family like
 * `Evil"><script>` both fail and fall back. These mirror the guards in
 * lib/preview/toSandpack.ts rather than importing them — that module is the
 * preview's private business and should stay free to change.
 */

const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9a-z.,%/\s]+\)|[a-z]{3,20})$/i;
const SAFE_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,39}$/;
const SAFE_LENGTH_RE = /^[0-9]*\.?[0-9]+(px|rem|em|%)?$/;

interface ThemeTokens {
  colors: Readonly<Record<string, string>>;
  heading: string;
  body: string;
  mono: string;
  radius: string;
}

function safeValue(value: string | undefined, pattern: RegExp, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return pattern.test(trimmed) ? trimmed : fallback;
}

function tokensFor(theme: Theme): ThemeTokens {
  const primary = safeValue(theme.colors.primary, SAFE_COLOR_RE, "#111111");
  return {
    colors: {
      primary,
      secondary: safeValue(theme.colors.secondary, SAFE_COLOR_RE, "#f5f5f5"),
      accent: safeValue(theme.colors.accent, SAFE_COLOR_RE, primary),
      background: safeValue(theme.colors.background, SAFE_COLOR_RE, "#ffffff"),
      foreground: safeValue(theme.colors.foreground, SAFE_COLOR_RE, "#111111"),
      muted: safeValue(theme.colors.muted, SAFE_COLOR_RE, "#737373"),
      border: safeValue(theme.colors.border, SAFE_COLOR_RE, "#e5e5e5"),
    },
    heading: safeValue(theme.fonts.heading, SAFE_FAMILY_RE, "Inter"),
    body: safeValue(theme.fonts.body, SAFE_FAMILY_RE, "Inter"),
    mono: safeValue(theme.fonts.mono, SAFE_FAMILY_RE, "IBM Plex Mono"),
    radius: safeValue(theme.radius, SAFE_LENGTH_RE, "0.5rem"),
  };
}

/** Replaces C0/DEL control characters with a space, optionally sparing newlines. */
function stripControls(value: string, keepNewlines: boolean): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x0a) {
      result += keepNewlines ? "\n" : " ";
    } else if (code < 0x20 || code === 0x7f) {
      result += " ";
    } else {
      result += character;
    }
  }
  return result;
}

/** Collapses a model-supplied value onto a single safe line. */
function cleanLine(value: string | undefined, max: number): string {
  return stripControls(value ?? "", false).replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** As `cleanLine`, but newlines survive — used for the prompt in the README. */
function cleanBlock(value: string | undefined, max: number): string {
  return stripControls((value ?? "").replace(/\r\n?/g, "\n"), true).trim().slice(0, max).trim();
}

/* ─────────────────────────────── scaffold: css ──────────────────────────── */

function fontStack(family: string, kind: "sans" | "serif" | "mono"): string {
  const fallback =
    kind === "serif"
      ? "ui-serif, Georgia, serif"
      : kind === "mono"
        ? "ui-monospace, SFMono-Regular, monospace"
        : "ui-sans-serif, system-ui, sans-serif";
  return `"${family}", ${fallback}`;
}

function globalsSource(tokens: ThemeTokens): string {
  const colorTokens = Object.entries(tokens.colors)
    .map(([name, value]) => `  --color-${name}: ${value};`)
    .join("\n");
  const rootTokens = Object.entries(tokens.colors)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");

  return `@import "tailwindcss";

/* Tailwind v4 keeps its design tokens in CSS rather than a config file. Every
   custom property declared here becomes a utility: --color-primary gives
   bg-primary / text-primary, --font-heading gives font-heading. */
@theme {
${colorTokens}

  --font-sans: ${fontStack(tokens.body, "sans")};
  --font-body: ${fontStack(tokens.body, "sans")};
  --font-heading: ${fontStack(tokens.heading, "serif")};
  --font-display: ${fontStack(tokens.heading, "serif")};
  --font-serif: ${fontStack(tokens.heading, "serif")};
  --font-mono: ${fontStack(tokens.mono, "mono")};

  --radius-theme: ${tokens.radius};
}

/* Plain custom properties as well: generated components occasionally reach for
   var(--primary) instead of a utility class. */
:root {
${rootTokens}
  --radius: ${tokens.radius};
}

html {
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-body);
}

h1,
h2,
h3,
h4,
h5,
h6 {
  font-family: var(--font-heading);
}
`;
}

/* ────────────────────────────── scaffold: app ───────────────────────────── */

/**
 * Google Fonts answers 400 for a family that lacks a requested weight, which
 * would take the whole stylesheet down, so each family gets a weighted link and
 * a bare one that can only ever succeed.
 */
function fontHrefs(families: readonly string[]): string[] {
  const hrefs: string[] = [];
  for (const family of Array.from(new Set(families))) {
    const param = encodeURIComponent(family).replace(/%20/g, "+");
    hrefs.push(
      `https://fonts.googleapis.com/css2?family=${param}:wght@300;400;500;600;700;800&display=swap`,
      `https://fonts.googleapis.com/css2?family=${param}&display=swap`,
    );
  }
  return hrefs;
}

function layoutSource(name: string, summary: string, tokens: ThemeTokens): string {
  const description = summary.length > 0 ? summary : `${name} — built with Next.js and Tailwind CSS.`;
  const hrefs = fontHrefs([tokens.heading, tokens.body])
    .map((href) => `  ${JSON.stringify(href)},`)
    .join("\n");

  return `import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * The theme's fonts are linked rather than loaded through next/font/google.
 * next/font/google fails the build outright for a family name that does not
 * exist, and these names were chosen by a language model; a plain stylesheet
 * link simply falls back to the generic stack when the family is unknown.
 */
const FONT_HREFS = [
${hrefs}
];

export const metadata: Metadata = {
  title: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        {FONT_HREFS.map((href) => (
          <link href={href} key={href} rel="stylesheet" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
`;
}

/** Only reached when the generation never produced a page — the export still boots. */
function fallbackPageSource(name: string, summary: string): string {
  const subtitle = summary.length > 0 ? summary : "This project was exported before a page was generated.";
  return `export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">{${JSON.stringify(name)}}</h1>
      <p className="text-base opacity-70">{${JSON.stringify(subtitle)}}</p>
    </main>
  );
}
`;
}

/**
 * A route the rest of the shop links to but which was never generated.
 *
 * Written against the theme utilities in `globals.css` rather than hard-coded
 * colours, so it reads as part of the shop it is standing in for.
 */
function pendingRouteSource(name: string, pageType: PageType): string {
  const label = PAGE_TYPE_LABELS[pageType].toLowerCase();

  return `/**
 * ${PAGE_ROUTES[pageType]} — a real route with nothing behind it yet.
 *
 * This shop's ${label} had not been generated when the project was exported,
 * and the other pages link here. Replace this file (and add its components) to
 * finish the route; nothing else needs changing.
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-muted">${escapeJsxText(name)}</p>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        The ${label} is on its way
      </h1>
      <p className="max-w-md text-base text-muted">
        This route is part of the shop, but the page has not been built yet.
      </p>
      <a
        className="mt-2 inline-flex items-center rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        href="/"
      >
        Back to the shop
      </a>
    </main>
  );
}
`;
}

/** Model-supplied text going into JSX children rather than an attribute. */
function escapeJsxText(value: string): string {
  return value.replace(/[{}<>]/g, " ").replace(/\s+/g, " ").trim();
}

/* ──────────────────────────── scaffold: manifests ───────────────────────── */

function packageJsonSource(slug: string, summary: string): string {
  const manifest = {
    name: slug,
    version: "0.1.0",
    private: true,
    ...(summary.length > 0 ? { description: summary } : {}),
    // No `lint` script: ESLint is not a dependency here, and `next lint` both
    // opens an interactive installer when it is missing and is deprecated in
    // Next 15.5. Adding ESLint yourself is a two-minute job if you want it.
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
    },
    dependencies: DEPENDENCIES,
    devDependencies: DEV_DEPENDENCIES,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const TSCONFIG_SOURCE = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2017",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [{ name: "next" }],
      paths: { "@/*": ["./*"] },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  },
  null,
  2,
)}\n`;

/**
 * Every https host the generated markup loads an image from.
 *
 * picsum.photos is always there for the placeholders; a shop built from
 * uploaded photos also points at the Supabase storage host they were uploaded
 * to, which is not known until export time. Next refuses to render a remote
 * host through next/image that it has not been told about, so both have to be
 * declared even though the generated code normally uses a plain <img>.
 */
function remoteImageHosts(files: FileMap): string[] {
  const hosts = new Set<string>(["picsum.photos"]);
  const url = /https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/[^\s"'`)]*/gi;

  for (const contents of Object.values(files)) {
    for (const [href, host] of contents.matchAll(url)) {
      const looksLikeAnImage =
        /\.(png|jpe?g|webp|avif|gif|svg)($|\?)/i.test(href) || href.includes("/storage/v1/object/");
      if (host && looksLikeAnImage) hosts.add(host.toLowerCase());
    }
  }

  return [...hosts].sort();
}

function nextConfigSource(hosts: readonly string[]): string {
  const patterns = hosts
    .map((hostname) => `      { protocol: "https", hostname: "${hostname}" },`)
    .join("\n");

  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
${patterns}
    ],
  },
};

export default nextConfig;
`;
}

const POSTCSS_CONFIG_SOURCE = `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`;

const NEXT_ENV_SOURCE = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;

const GITIGNORE_SOURCE = `node_modules
.next
out
.env*
.DS_Store
`;

/* ─────────────────────────────── scaffold: docs ─────────────────────────── */

interface ReadmeInput {
  name: string;
  summary: string;
  pageType: PageType;
  /** Every page in this export, in route order. */
  pageTypes: readonly PageType[];
  /** Routes that exist as a holding page because they were never generated. */
  pending: readonly PageType[];
  /** Chrome written once and imported by every route. */
  shared: readonly string[];
  prompt?: string;
  files: FileMap;
}

function readmeSource({
  name,
  summary,
  pageType,
  pageTypes,
  pending,
  shared,
  prompt,
  files,
}: ReadmeInput): string {
  const label = PAGE_TYPE_LABELS[pageType].toLowerCase();
  const componentPaths = Object.keys(files)
    .filter((path) => path.startsWith("components/"))
    .sort();

  const description =
    pageTypes.length > 1
      ? `A ${pageTypes.map((type) => PAGE_TYPE_LABELS[type].toLowerCase()).join(" and a ")} generated by DropShipping, sharing one design system.`
      : `A ${label} generated by DropShipping.`;

  const sections: string[] = [
    `# ${name}`,
    summary.length > 0 ? summary : description,
    `This is a plain Next.js 15 project — App Router, TypeScript, Tailwind CSS v4 — with no
DropShipping runtime dependency. Edit it, deploy it or throw it away; nothing here
phones home.`,
    `## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

Then open <http://localhost:3000>. \`npm run build\` produces the production bundle and
type-checks the project. ESLint is deliberately not installed, to keep \`npm install\`
light — add it yourself if you want linting.`,
  ];

  const cleanedPrompt = cleanBlock(prompt, 2000);
  if (cleanedPrompt.length > 0) {
    const quoted = cleanedPrompt
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
    sections.push(`## The prompt it came from\n\n${quoted}`);
  }

  if (pageTypes.length > 1 || pending.length > 0) {
    const rows = [
      ...pageTypes.map((type, index) =>
        index === 0
          ? `| \`/\` | ${PAGE_TYPE_LABELS[type]} | \`app/page.tsx\` |`
          : `| \`/${SECONDARY_ROUTES[type]}\` | ${PAGE_TYPE_LABELS[type]} | \`app/${SECONDARY_ROUTES[type]}/page.tsx\` |`,
      ),
      ...pending.map(
        (type) =>
          `| \`/${SECONDARY_ROUTES[type]}\` | ${PAGE_TYPE_LABELS[type]} — not built yet | \`app/${SECONDARY_ROUTES[type]}/page.tsx\` |`,
      ),
    ].join("\n");

    const chrome =
      shared.length > 0
        ? `\n\nThe chrome is shared rather than duplicated: ${shared
            .map((path) => `\`${path}\``)
            .join(" and ")} ${shared.length > 1 ? "are" : "is"} written once and imported by
every route. Whichever navigation link points at the route being rendered marks itself with
\`aria-current\`, which is why it reads the path from \`usePathname()\` instead of hard-coding
it. Edit it once and every page follows.`
        : "";

    const note =
      pending.length > 0
        ? `The pages that were generated share one palette, type scale and corner radius, so they
read as one shop. The route marked *not built yet* is a holding page: the rest of the site
links to it, so it exists rather than 404ing. Replace that file when you build the page for
real. Each page keeps its own section components: the landing page's live in \`components/\`,
and every other page has its own folder beside them.${chrome}`
        : `Both pages were generated against the same palette, type scale and corner radius, so
they read as one shop. Each page keeps its own section components: the landing page's live in
\`components/\`, and every other page has its own folder beside them.${chrome}`;

    sections.push(`## Routes

| Route | Page | Entry |
| --- | --- | --- |
${rows}

${note}`);
  }

  const layout = [
    "| Path | What it is |",
    "| --- | --- |",
    "| `app/layout.tsx` | Root layout: metadata, font links, global stylesheet. |",
    "| `app/page.tsx` | The page itself, composing the components below. |",
    "| `app/globals.css` | Tailwind entry plus the generated theme as CSS tokens. |",
    ...componentPaths.map((path) => `| \`${path}\` | Section component. |`),
    "| `theme.json` | The generated palette, fonts and radius, for reference. |",
  ].join("\n");
  sections.push(`## Layout\n\n${layout}`);

  sections.push(`## Styling

Tailwind v4 has no \`tailwind.config.js\`: the theme lives in \`app/globals.css\` inside the
\`@theme\` block, which is also where the colours and fonts from \`theme.json\` were compiled
to. Change a value there and every utility that uses it follows.`);

  const uploaded = remoteImageHosts(files).filter((host) => host !== "picsum.photos");

  sections.push(
    uploaded.length > 0
      ? `## Images

Photos you uploaded are served from your Supabase storage bucket (\`${uploaded.join("`, `")}\`),
and the bucket is public so this site keeps working wherever you deploy it. **The images
disappear if you delete that bucket or the Supabase project** — to cut the dependency,
download them into \`public/\` and point the \`src\` attributes at the local paths.

Anything you did not upload points at [picsum.photos](https://picsum.photos), which serves a
stable random photo per seed. Those are placeholders; swap them for real photography before
you put this in front of customers.`
      : `## Images

Every image points at [picsum.photos](https://picsum.photos), which serves a stable random
photo per seed. They are placeholders — swap the URLs for real product photography before
you put this in front of customers.`,
  );

  return `${sections.join("\n\n")}\n`;
}
