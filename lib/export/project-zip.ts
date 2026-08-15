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

import type { FileMap, PageType, Theme } from "@/lib/types";
import { PAGE_TYPE_LABELS, THEME_FILE_NAME, normalizeTheme } from "@/lib/types";

/* ──────────────────────────────── contract ──────────────────────────────── */

export interface ExportProjectInput {
  /** The canonical Next.js tree from the generator. */
  files: FileMap;
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
  const generated = sanitizeFiles(input.files);
  const theme = normalizeTheme(input.theme ?? parseThemeFile(generated[THEME_FILE_NAME]));
  const tokens = tokensFor(theme);

  const name = cleanLine(input.name, 80) || DEFAULT_NAME;
  const summary = cleanLine(input.summary, 200);
  const pageType: PageType = input.pageType === "product" ? "product" : "landing";
  const slug = exportProjectSlug(name);

  const merged: FileMap = { ...generated };
  const write = (path: string, contents: string): void => {
    if (path in merged) return;
    merged[path] = contents;
  };

  write(ENTRY_PATH, fallbackPageSource(name, summary));
  write("app/layout.tsx", layoutSource(name, summary, tokens));
  write("app/globals.css", globalsSource(tokens));
  write("package.json", packageJsonSource(slug, summary));
  write("tsconfig.json", TSCONFIG_SOURCE);
  write("next.config.ts", NEXT_CONFIG_SOURCE);
  write("postcss.config.mjs", POSTCSS_CONFIG_SOURCE);
  write("next-env.d.ts", NEXT_ENV_SOURCE);
  write(".gitignore", GITIGNORE_SOURCE);
  write(THEME_FILE_NAME, `${JSON.stringify(theme, null, 2)}\n`);
  write(
    "README.md",
    readmeSource({ name, summary, pageType, prompt: input.prompt, files: merged }),
  );

  return sortKeys(merged);
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
 * picsum.photos is whitelisted because generated components sometimes reach for
 * next/image, and Next refuses to render a remote host it has not been told
 * about. Costs nothing when the code uses a plain <img>, which is the norm.
 */
const NEXT_CONFIG_SOURCE = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },
};

export default nextConfig;
`;

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
  prompt?: string;
  files: FileMap;
}

function readmeSource({ name, summary, pageType, prompt, files }: ReadmeInput): string {
  const label = PAGE_TYPE_LABELS[pageType].toLowerCase();
  const componentPaths = Object.keys(files)
    .filter((path) => path.startsWith("components/"))
    .sort();

  const sections: string[] = [
    `# ${name}`,
    summary.length > 0 ? summary : `A ${label} generated by DropShipping.`,
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

  sections.push(`## Images

Every image points at [picsum.photos](https://picsum.photos), which serves a stable random
photo per seed. They are placeholders — swap the URLs for real product photography before
you put this in front of customers.`);

  return `${sections.join("\n\n")}\n`;
}
