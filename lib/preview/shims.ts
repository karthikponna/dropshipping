/**
 * Virtual modules injected into the Sandpack preview project.
 *
 * Sandpack runs a `vite-react-ts` sandbox, so anything the model imports from
 * `next/*` has to resolve to something. Rather than regex-rewriting JSX call
 * sites — which breaks the moment a prop spans two lines or holds an
 * expression — the adapter rewrites only the module *specifier* and lets these
 * real modules absorb the Next-only API surface.
 *
 * Every source string here is code that runs inside the sandbox, never in this
 * app, so it is written against the sandbox's React 19 + esbuild toolchain.
 */

import { PREVIEW_NAVIGATE_MESSAGE } from "./navigation";

/** Directory (relative to the sandbox root) that holds every injected module. */
export const SHIM_DIR = "shims";

/** Bare `next/*` specifiers that map onto a shim module, keyed by specifier. */
export const NEXT_MODULE_SHIMS: Readonly<Record<string, string>> = {
  "next/image": `${SHIM_DIR}/next-image.tsx`,
  "next/link": `${SHIM_DIR}/next-link.tsx`,
  "next/navigation": `${SHIM_DIR}/next-navigation.ts`,
  "next/router": `${SHIM_DIR}/next-navigation.ts`,
  "next/headers": `${SHIM_DIR}/next-headers.ts`,
};

/** `next/font/*` needs a statement rewrite, not just a specifier rewrite. */
export const NEXT_FONT_SPECIFIERS: readonly string[] = [
  "next/font/google",
  "next/font/local",
  "@next/font/google",
  "@next/font/local",
];

export const NEXT_FONT_SHIM = `${SHIM_DIR}/next-font.ts`;

/** Packages the sandbox already has — imports of these are left untouched. */
export const SANDBOX_PACKAGES: readonly string[] = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom/server",
];

const NEXT_IMAGE_SOURCE = `import * as React from "react";

type ImageSrc = string | { src?: string; default?: { src?: string } };

interface ShimImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: ImageSrc;
  fill?: boolean;
  priority?: boolean;
  quality?: number | string;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: unknown;
  onLoadingComplete?: unknown;
  overrideSrc?: string;
}

function resolveSrc(src?: ImageSrc): string | undefined {
  if (typeof src === "string") return src;
  if (src && typeof src === "object") {
    if (typeof src.src === "string") return src.src;
    if (src.default && typeof src.default.src === "string") return src.default.src;
  }
  return undefined;
}

/**
 * next/image without the Next runtime: the Next-only props are absorbed here
 * instead of leaking onto the DOM node and tripping React's unknown-attribute
 * warnings. "fill" becomes the absolute-cover style Next applies for you.
 */
export default function Image(props: ShimImageProps) {
  const {
    src,
    alt,
    fill,
    priority,
    quality,
    placeholder,
    blurDataURL,
    unoptimized,
    loader,
    onLoadingComplete,
    overrideSrc,
    style,
    width,
    height,
    loading,
    ...rest
  } = props;

  void quality;
  void placeholder;
  void blurDataURL;
  void unoptimized;
  void loader;
  void onLoadingComplete;

  const fillStyle: React.CSSProperties = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }
    : {};

  return (
    <img
      {...rest}
      alt={typeof alt === "string" ? alt : ""}
      src={overrideSrc || resolveSrc(src)}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? "eager" : loading}
      fetchPriority={priority ? "high" : undefined}
      style={{ ...fillStyle, ...style }}
    />
  );
}
`;

const NEXT_LINK_SOURCE = `import * as React from "react";

type LinkHref = string | { pathname?: string; hash?: string; query?: Record<string, unknown> };

interface ShimLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href?: LinkHref;
  prefetch?: unknown;
  replace?: unknown;
  scroll?: unknown;
  shallow?: unknown;
  passHref?: unknown;
  locale?: unknown;
  legacyBehavior?: unknown;
}

function toHref(href?: LinkHref): string {
  if (typeof href === "string") return href;
  if (href && typeof href === "object") {
    const entries = href.query ? Object.entries(href.query) : [];
    const query = entries
      .map((entry) => encodeURIComponent(entry[0]) + "=" + encodeURIComponent(String(entry[1])))
      .join("&");
    const base = typeof href.pathname === "string" ? href.pathname : "#";
    return base + (query ? "?" + query : "") + (href.hash ? "#" + href.hash : "");
  }
  return "#";
}

/** next/link as a plain anchor; router-only props are swallowed. */
export default function Link(props: ShimLinkProps) {
  const {
    href,
    prefetch,
    replace,
    scroll,
    shallow,
    passHref,
    locale,
    legacyBehavior,
    children,
    ...rest
  } = props;

  void prefetch;
  void replace;
  void scroll;
  void shallow;
  void passHref;
  void locale;
  void legacyBehavior;

  return (
    <a {...rest} href={toHref(href)}>
      {children}
    </a>
  );
}
`;

const NEXT_NAVIGATION_SOURCE = `const noop = (): void => {};

export function useRouter() {
  return { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop };
}

export function usePathname(): string {
  return "/";
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(): void {}

export function permanentRedirect(): void {}

export function notFound(): void {}

export default {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
  redirect,
  permanentRedirect,
  notFound,
};
`;

const NEXT_HEADERS_SOURCE = `const emptyMap = new Map<string, string>();

export function headers() {
  return { get: () => null, has: () => false, forEach: () => {}, entries: () => emptyMap.entries() };
}

export function cookies() {
  return { get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} };
}

export function draftMode() {
  return { isEnabled: false, enable: () => {}, disable: () => {} };
}

export default { headers, cookies, draftMode };
`;

const NEXT_FONT_SOURCE = `export interface FontResult {
  className: string;
  variable: string;
  style: { fontFamily: string; fontStyle?: string; fontWeight?: number };
}

type FontLoader = (options?: Record<string, unknown>) => FontResult;

/** "Playfair_Display" is how next/font names "Playfair Display". */
function familyFor(name: string): string {
  const family = name.replace(/_/g, " ").trim();
  return family.length > 0 ? family : "sans-serif";
}

function loaderFor(name: string): FontLoader {
  const family = familyFor(name);
  return function load(): FontResult {
    return {
      className: "",
      variable: "",
      style: { fontFamily: "'" + family + "', ui-sans-serif, system-ui, sans-serif" },
    };
  };
}

/**
 * next/font exports one named loader per typeface, so the set of exports is
 * unknowable ahead of time. A proxy answers for any name; the adapter turns
 * "import { Inter } from 'next/font/google'" into a destructure of this object.
 * The webfont itself is loaded by the <link> tags the adapter writes into
 * index.html, so returning an empty className is correct here.
 */
const fonts: Record<string, FontLoader> = new Proxy({} as Record<string, FontLoader>, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    return loaderFor(property);
  },
});

export default fonts;
`;

/**
 * Module that turns an in-site link click into a route change outside. Exported
 * extension-less as well, since the sandbox root imports it by specifier.
 */
export const PREVIEW_NAVIGATION_MODULE = `${SHIM_DIR}/preview-navigation`;

export const PREVIEW_NAVIGATION_SHIM = `${PREVIEW_NAVIGATION_MODULE}.ts`;

/**
 * The sandbox half of preview navigation.
 *
 * The generated markup uses plain `<a href="/product">` — the engineering rules
 * forbid next/link — so shimming a component is not enough; the listener has to
 * be on the document. It runs in the capture phase and only for a left click
 * with no modifier on an anchor whose href starts with a slash, which leaves
 * fragment anchors scrolling natively and modified clicks alone.
 *
 * The message goes to both `parent` and `top`: Sandpack's preview sits inside
 * its own wrapper frame, so the app's window is not reliably one hop up.
 */
const PREVIEW_NAVIGATION_SOURCE = `const MESSAGE_TYPE = ${JSON.stringify(PREVIEW_NAVIGATE_MESSAGE)};

function anchorFor(target: EventTarget | null): HTMLAnchorElement | null {
  if (target === null || !(target instanceof Element)) return null;
  return target.closest("a");
}

function announce(href: string): void {
  const payload = { type: MESSAGE_TYPE, href };
  const seen: Window[] = [];

  for (const candidate of [window.parent, window.top]) {
    if (!candidate || candidate === window || seen.includes(candidate)) continue;
    seen.push(candidate);
    try {
      candidate.postMessage(payload, "*");
    } catch {
      // A frame we cannot reach is not worth failing a click over.
    }
  }
}

/** Installs the interceptor. Safe to call more than once per document. */
export default function installPreviewNavigation(): void {
  if (typeof document === "undefined") return;

  document.addEventListener(
    "click",
    (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = anchorFor(event.target);
      const href = anchor?.getAttribute("href") ?? "";
      // Only same-origin paths: "#pricing" scrolls, "https://…" is somebody
      // else's site, "//host" is protocol-relative and therefore external.
      if (!href.startsWith("/") || href.startsWith("//")) return;

      event.preventDefault();
      announce(href);
    },
    true,
  );
}
`;

/** Every injected module, keyed by its path relative to the sandbox root. */
export const SHIM_FILES: Readonly<Record<string, string>> = {
  [`${SHIM_DIR}/next-image.tsx`]: NEXT_IMAGE_SOURCE,
  [`${SHIM_DIR}/next-link.tsx`]: NEXT_LINK_SOURCE,
  [`${SHIM_DIR}/next-navigation.ts`]: NEXT_NAVIGATION_SOURCE,
  [`${SHIM_DIR}/next-headers.ts`]: NEXT_HEADERS_SOURCE,
  [NEXT_FONT_SHIM]: NEXT_FONT_SOURCE,
  [PREVIEW_NAVIGATION_SHIM]: PREVIEW_NAVIGATION_SOURCE,
};

/* ─────────────────────── generated placeholder modules ─────────────────────── */

/** Shown as the page while nothing usable has streamed in yet. */
export const PLACEHOLDER_PAGE_SOURCE = `export default function PreviewPlaceholder() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-24">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 h-11 w-11 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
        <h1 className="text-2xl font-semibold tracking-tight text-black/80">Building your page</h1>
        <p className="mt-2.5 text-base text-black/45">Sections appear here as they are written.</p>
      </div>
    </main>
  );
}
`;

function skeletonBody(label: string): string {
  return `  return (
    <section aria-label=${JSON.stringify(`${label} placeholder`)} className="animate-pulse px-6 py-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="h-7 w-2/5 rounded-md bg-black/10" />
        <div className="h-4 w-3/5 rounded bg-black/[0.07]" />
        <div className="h-40 w-full rounded-xl bg-black/[0.04]" />
      </div>
    </section>
  );`;
}

/**
 * A component that has not finished streaming (or never arrived) is replaced by
 * a skeleton block, so a half-written tree still renders instead of throwing a
 * syntax error at the bundler.
 */
export function createSkeletonModuleSource(options: {
  /** Component name used for the default export, e.g. "Hero". */
  name: string;
  /** Named exports the importing file asked for. */
  namedExports?: readonly string[];
  /** Set when the importer only uses a default import. */
  withDefault?: boolean;
}): string {
  const safeName = toIdentifier(options.name, "Section");
  const parts: string[] = [
    `/* Placeholder for ${safeName} — the generated file has not arrived yet. */`,
    "",
  ];

  if (options.withDefault !== false) {
    parts.push(`export default function ${safeName}() {`, skeletonBody(safeName), "}", "");
  }

  for (const name of dedupe(options.namedExports ?? [])) {
    const exportName = toIdentifier(name, "Section");
    if (exportName === safeName && options.withDefault !== false) {
      parts.push(`export { ${exportName} };`, "");
      continue;
    }
    parts.push(`export function ${exportName}() {`, skeletonBody(exportName), "}", "");
  }

  return `${parts.join("\n")}\n`;
}

/**
 * An import of a package the sandbox does not have (an icon set, a utility) is
 * pointed at a stub exporting exactly the bindings the source asked for:
 * components render nothing, helpers behave like a className joiner.
 */
export function createPackageStubSource(options: {
  specifier: string;
  defaultName?: string;
  namedNames?: readonly string[];
  namespaceName?: string;
}): string {
  const lines: string[] = [
    `/* Stub for ${JSON.stringify(options.specifier)} — not installed in the browser preview. */`,
    "",
    "const StubComponent = (): null => null;",
    "",
    "const stubHelper = (...args: unknown[]): string =>",
    '  args.filter((value) => typeof value === "string").join(" ");',
    "",
  ];

  const valueFor = (name: string): string =>
    /^[A-Z]/.test(name) ? "StubComponent" : "stubHelper";

  if (options.defaultName) {
    lines.push(`export default ${valueFor(options.defaultName)};`, "");
  } else if (options.namespaceName) {
    lines.push("export default { StubComponent, stubHelper };", "");
  } else {
    lines.push("export default StubComponent;", "");
  }

  for (const name of dedupe(options.namedNames ?? [])) {
    const exportName = toIdentifier(name, "stubExport");
    lines.push(`export const ${exportName} = ${valueFor(exportName)};`);
  }

  return `${lines.join("\n")}\n`;
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

/** Coerces model-supplied text into something safe to emit as an identifier. */
export function toIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "");
  if (cleaned.length === 0 || /^[0-9]/.test(cleaned)) return fallback;
  return cleaned;
}
