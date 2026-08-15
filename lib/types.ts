/**
 * Shared contracts for the whole app. Every other module — the generation
 * route, the streaming parser, the Sandpack adapter, the dashboard and the
 * builder — imports its vocabulary from here. Treat the exported names as a
 * stable API; add to them rather than renaming.
 */

/* ────────────────────────────── page types ────────────────────────────── */

/** The two shapes of site the builder can produce. */
export type PageType = "landing" | "product";

export const PAGE_TYPES = ["landing", "product"] as const satisfies readonly PageType[];

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  landing: "Landing page",
  product: "Product page",
};

export function isPageType(value: unknown): value is PageType {
  return typeof value === "string" && (PAGE_TYPES as readonly string[]).includes(value);
}

/* ──────────────────────────────── files ───────────────────────────────── */

/**
 * A generated project as a flat map of POSIX-style paths relative to the
 * project root (`"app/page.tsx"`, `"components/Hero.tsx"`) to file contents.
 * This is the canonical Next.js tree: it is what gets stored, exported as a
 * zip, and fed to the Sandpack adapter — never mutate it for preview.
 */
export type FileMap = Record<string, string>;

/* ──────────────────────────────── theme ───────────────────────────────── */

export interface ThemeColors {
  primary: string;
  secondary?: string;
  accent?: string;
  background?: string;
  foreground?: string;
  muted?: string;
  border?: string;
}

export interface ThemeFonts {
  /** Google font family name, e.g. "Playfair Display". */
  heading: string;
  body: string;
  mono?: string;
}

/**
 * The design decisions the model makes for a generated shop, streamed in the
 * `<theme>` block. The Sandpack adapter turns this into a Tailwind Play CDN
 * config; the export writes it to `theme.json`.
 */
export interface Theme {
  colors: ThemeColors;
  fonts: ThemeFonts;
  /** CSS length, e.g. "0.5rem". Generated shops may be rounded or sharp. */
  radius?: string;
}

export const DEFAULT_THEME: Theme = {
  colors: {
    primary: "#111111",
    secondary: "#f5f5f5",
    accent: "#111111",
    background: "#ffffff",
    foreground: "#111111",
    muted: "#737373",
    border: "#e5e5e5",
  },
  fonts: { heading: "Inter", body: "Inter" },
  radius: "0.5rem",
};

/** File name used for the theme when a project is exported as a zip. */
export const THEME_FILE_NAME = "theme.json";

/** Coerces model output (possibly partial or malformed) into a usable Theme. */
export function normalizeTheme(input: unknown): Theme {
  if (typeof input !== "object" || input === null) return DEFAULT_THEME;

  const raw = input as { colors?: unknown; fonts?: unknown; radius?: unknown };
  const rawColors = (typeof raw.colors === "object" && raw.colors !== null ? raw.colors : {}) as Record<string, unknown>;
  const rawFonts = (typeof raw.fonts === "object" && raw.fonts !== null ? raw.fonts : {}) as Record<string, unknown>;

  const str = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

  return {
    colors: {
      primary: str(rawColors.primary, DEFAULT_THEME.colors.primary),
      secondary: str(rawColors.secondary, DEFAULT_THEME.colors.secondary ?? ""),
      accent: str(rawColors.accent, DEFAULT_THEME.colors.accent ?? ""),
      background: str(rawColors.background, DEFAULT_THEME.colors.background ?? ""),
      foreground: str(rawColors.foreground, DEFAULT_THEME.colors.foreground ?? ""),
      muted: str(rawColors.muted, DEFAULT_THEME.colors.muted ?? ""),
      border: str(rawColors.border, DEFAULT_THEME.colors.border ?? ""),
    },
    fonts: {
      heading: str(rawFonts.heading, DEFAULT_THEME.fonts.heading),
      body: str(rawFonts.body, DEFAULT_THEME.fonts.body),
      ...(typeof rawFonts.mono === "string" ? { mono: rawFonts.mono } : {}),
    },
    radius: str(raw.radius, DEFAULT_THEME.radius ?? "0.5rem"),
  };
}

/* ───────────────────────────── generation ───────────────────────────── */

/** Contents of the `<meta>` block: how the project is labelled in the UI. */
export interface GenerationMeta {
  name: string;
  summary: string;
  tagline?: string;
}

export const DEFAULT_META: GenerationMeta = {
  name: "Untitled shop",
  summary: "",
};

/** `create` writes a project from scratch; `refine` diffs onto existing files. */
export type GenerationMode = "create" | "refine";

export type GenerationPhase =
  | "connecting"
  | "planning"
  | "writing"
  | "repairing"
  | "saving"
  | "complete";

export type GenerationErrorCode =
  | "missing_key"
  | "invalid_key"
  | "rate_limited"
  | "upstream_error"
  | "truncated_stream"
  | "missing_files"
  | "unauthorized"
  | "bad_request"
  | "aborted"
  | "unknown";

/** Codes worth offering a retry button for. */
export const RETRYABLE_ERROR_CODES: readonly GenerationErrorCode[] = [
  "rate_limited",
  "upstream_error",
  "truncated_stream",
  "missing_files",
  "unknown",
];

export function isRetryableErrorCode(code: GenerationErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(code);
}

/** POST body of `/api/generate`. */
export interface GenerateRequestBody {
  pageType: PageType;
  prompt: string;
  mode: GenerationMode;
  /** Set for `refine`, and whenever the generation belongs to a saved project. */
  projectId?: string;
  /** Existing tree to diff against in `refine` mode. */
  baseFiles?: FileMap;
  baseTheme?: Theme;
}

/**
 * One frame of the generation stream. The route serialises these as NDJSON
 * (one JSON object per line) — see `encodeGenerationEvent`.
 */
export type GenerationEvent =
  | { type: "status"; phase: GenerationPhase; message?: string }
  | { type: "meta"; meta: GenerationMeta }
  | { type: "theme"; theme: Theme }
  | { type: "file_start"; path: string }
  | { type: "file_delta"; path: string; delta: string }
  | { type: "file_complete"; path: string; content: string }
  /** Assistant prose emitted outside any tag, for the chat rail. */
  | { type: "text"; delta: string }
  | {
      type: "done";
      files: FileMap;
      theme: Theme;
      meta: GenerationMeta;
      /** Present once the generation has been persisted as a version. */
      versionId?: string;
      projectId?: string;
    }
  | {
      type: "error";
      code: GenerationErrorCode;
      message: string;
      retryable: boolean;
    };

export const GENERATION_STREAM_CONTENT_TYPE = "application/x-ndjson";

/** Serialise one event as a single NDJSON line (newline included). */
export function encodeGenerationEvent(event: GenerationEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Parse one NDJSON line back into an event. Returns null for blank/garbage. */
export function parseGenerationEvent(line: string): GenerationEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { type?: unknown }).type === "string") {
      return parsed as GenerationEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/** Typed failure thrown by the generation pipeline and key resolution. */
export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  readonly retryable: boolean;
  /** HTTP status to answer with when this surfaces in a route handler. */
  readonly status: number;

  constructor(
    code: GenerationErrorCode,
    message: string,
    options?: { status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GenerationError";
    this.code = code;
    this.retryable = options?.retryable ?? isRetryableErrorCode(code);
    this.status = options?.status ?? defaultStatusForErrorCode(code);
  }

  toEvent(): Extract<GenerationEvent, { type: "error" }> {
    return {
      type: "error",
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

function defaultStatusForErrorCode(code: GenerationErrorCode): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "missing_key":
    case "invalid_key":
      return 400;
    case "bad_request":
      return 400;
    case "rate_limited":
      return 429;
    case "aborted":
      return 499;
    default:
      return 500;
  }
}

/* ──────────────────────────────── chat ────────────────────────────────── */

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessageStatus = "streaming" | "complete" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status?: ChatMessageStatus;
  errorCode?: GenerationErrorCode;
  retryable?: boolean;
}

/* ──────────────────────── database row contracts ─────────────────────── */

/** `public.profiles` — one row per auth user, created by a trigger. */
export interface ProfileRecord {
  id: string;
  email: string | null;
  full_name: string | null;
  /** AES-256-GCM payload from lib/crypto.ts. Never send this to the client. */
  anthropic_key_encrypted: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.projects`. */
export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  page_type: PageType;
  initial_prompt: string;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.versions` — one row per generation, `idx` starts at 1. */
export interface VersionRecord {
  id: string;
  project_id: string;
  idx: number;
  prompt: string;
  files: FileMap;
  theme: Theme;
  created_at: string;
}

/** Project joined with the version currently being previewed. */
export interface ProjectWithVersion extends ProjectRecord {
  current_version: VersionRecord | null;
}

/** Row shape for the version-history drawer (files omitted for weight). */
export type VersionSummary = Omit<VersionRecord, "files" | "theme">;

/* ────────────────────────────── auth forms ───────────────────────────── */

/**
 * Return value of the auth server actions in lib/auth/actions.ts, shaped for
 * React's `useActionState`.
 */
export interface AuthActionState {
  error: string | null;
  /** Set when signup succeeded but the address still needs confirming. */
  notice?: string | null;
}

export const AUTH_ACTION_INITIAL_STATE: AuthActionState = { error: null, notice: null };

/* ───────────────────────────── preview panel ─────────────────────────── */

export type PreviewDevice = "desktop" | "tablet" | "mobile";

export const PREVIEW_DEVICE_WIDTHS: Record<PreviewDevice, number> = {
  desktop: 1280,
  tablet: 834,
  mobile: 390,
};

export type PreviewTab = "preview" | "code";

/* ───────────────────── predefined component framework ────────────────── */

/** One slot the model must fill, described tightly enough to be prompt text. */
export interface ComponentShell {
  /** Path relative to the project root, e.g. "components/Hero.tsx". */
  path: string;
  /** Default-exported component name, e.g. "Hero". */
  name: string;
  /** One line on what this component is for. */
  purpose: string;
  /**
   * The exact signature the model must implement, rendered verbatim into the
   * system prompt. Deliberately unannotated: React 19's types have no
   * `JSX.Element` global, so a signature carrying one would not compile in the
   * exported project.
   */
  signature: string;
  /** Hard requirements, rendered as bullets in the system prompt. */
  requirements: string[];
}

/** The complete contract for one page type. */
export interface PageFramework {
  pageType: PageType;
  label: string;
  description: string;
  /** Every file the model must emit, in emission order. */
  requiredFiles: readonly string[];
  /** The page that composes the components. */
  entryFile: string;
  /** Component order inside the entry file. */
  composition: readonly string[];
  components: readonly ComponentShell[];
  /** Extra page-type-specific instructions for the system prompt. */
  promptGuidance: readonly string[];
}
