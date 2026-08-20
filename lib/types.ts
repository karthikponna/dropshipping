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
  /** Reading the memory graph for design and past-project context. */
  | "recalling"
  /** Claude querying the graph itself, deciding what this change touches. */
  | "investigating"
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

/* ──────────────────────────── uploaded images ─────────────────────────── */

/** Storage bucket the composer uploads into. Public: see migration 0003. */
export const SHOP_ASSETS_BUCKET = "shop-assets";

/** How many images one generation turn may carry. */
export const MAX_ATTACHMENTS = 6;

/**
 * An image the user attached in the composer, already uploaded.
 *
 * It does two jobs at once, which is why it carries both a URL and a
 * description: Claude is shown the picture so it can write copy about the real
 * product and pull the palette off it, and the same URL is what the generated
 * page points `<img src>` at. That is the whole reason uploads go to a public
 * bucket rather than travelling as base64 — the exported site has to keep
 * working on somebody else's server.
 */
export interface ImageAsset {
  /** Stable per attachment, minted client-side. */
  id: string;
  /** Public URL, both for the model and for the generated markup. */
  url: string;
  /** Object path inside the bucket, for deletion. */
  path: string;
  /** Original file name, shown in the UI and used to name the subject. */
  name: string;
  mimeType: string;
  width: number;
  height: number;
  /** Bytes after the browser downscaled it. */
  size: number;
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
  /** Images the user attached to this turn, already in the bucket. */
  attachments?: ImageAsset[];
  /**
   * Groups the generations of one sitting so the memory graph can tell "these
   * were built together" from "these were built weeks apart". The client mints
   * it and reuses it for the lifetime of the tab.
   */
  sessionId?: string;
}

/* ─────────────────────────────── memory ──────────────────────────────── */

/**
 * Something the HydraDB graph contributed to this run, surfaced so the user can
 * see why the model already knew something — silent memory reads as a bug.
 */
export interface MemoryNotice {
  kind: "inherited-design" | "recalled-project" | "narrowed-context" | "consulted-graph";
  /** One line for the chat rail, e.g. "Matching your landing page's design." */
  message: string;
  /** Supporting detail: matched concepts, the source page, the file count. */
  detail?: string;
  /** Set for `recalled-project`, so the UI can link to what was remembered. */
  projectId?: string;
}

/**
 * One earlier turn of the current sitting, read back out of the graph.
 *
 * The generation stream carries no transcript, so by the fourth or tenth
 * instruction this is the only record of what "that section" refers to. It is
 * a plain type here rather than in `lib/hydra` so the prompt builders can
 * render it without importing the graph client.
 */
export interface SessionTurn {
  versionId: string;
  pageType: PageType;
  /** What the user asked for, clipped to 1000 characters at ingest. */
  prompt: string;
  mode: string;
  /** The shop name that turn produced. */
  name: string;
  summary: string;
  createdAt: number;
}

/** A component of one page as the graph knows it: metadata, never source. */
export interface InventoryEntry {
  /** Graph node id, so a caller can traverse IMPORTS without a second lookup. */
  id: number;
  path: string;
  name: string;
  purpose: string;
  isEntry: boolean;
  isClient: boolean;
  lineCount: number;
}

/** One page of a shop from an earlier sitting, as the graph knows it. */
export interface PastShopPage {
  pageType: PageType;
  /** Newest generation of this page — the key to its row in `versions`. */
  versionId: string;
  /** Epoch ms that generation was written. This is what "yesterday" means. */
  builtAt: number;
  /** How many times this page has been generated or refined. */
  generations: number;
}

/**
 * A shop from an earlier sitting, listed for the model to choose between.
 *
 * Recall answers "which past shop is this prompt about" with one project and a
 * theme. This is the wider view, and it exists for one reason recall cannot
 * cover: a user saying "the same as yesterday" is pointing at a date, so the
 * dates have to be in front of the model rather than folded into a ranking.
 */
export interface PastShop {
  projectId: string;
  name: string;
  summary: string;
  /** Epoch ms the project was last touched. */
  updatedAt: number;
  pages: PastShopPage[];
}

/** One file of a past shop, read back out of Postgres for the model to adapt. */
export interface RecalledSource {
  path: string;
  contents: string;
}

/** The slice of a past shop's source a create turn decided to build on. */
export interface RecalledCode {
  projectId: string;
  /**
   * The shop the source actually came from, which is not always the one recall
   * named: the investigation gets the whole list and can reasonably disagree,
   * so anything shown to the user has to be labelled from here rather than from
   * the recall notice printed a moment earlier.
   */
  name: string;
  pageType: PageType;
  sources: readonly RecalledSource[];
}

/**
 * What Claude worked out for itself before a generation was written.
 *
 * The investigation turn is given the graph as tools and asked what this change
 * needs; this is what it came back with. `contextPaths` is the important part on
 * a refinement — it is the set of files the model chose to open, which is a far
 * better answer to "what does this change touch" than matching the instruction
 * against component names, because the model read the session history first.
 * `recalledCode` is its counterpart on a create turn that reaches backwards:
 * the components of an earlier shop the new page is to be modelled on.
 */
export interface Investigation {
  /** The model's own brief, handed to the writing turn verbatim. */
  plan: string;
  /** Files it opened, and therefore the files the writing turn is shown. */
  contextPaths: string[] | null;
  /** Session turns it was able to see, for the writing turn to reuse. */
  history: readonly SessionTurn[];
  /** How many tool calls it made, for the notice in the chat rail. */
  toolCalls: number;
  /** Source it opened out of an earlier shop, on a create turn. */
  recalledCode?: RecalledCode | null;
}

/** The design language of a page already in this project, carried to a new one. */
export interface InheritedDesignContext {
  sourcePageType: PageType;
  theme: Theme;
  shopName: string;
  summary: string;
  /** Section component names of the source page. */
  sections: string[];
  /**
   * The source page's header and footer, verbatim. Present so this page can
   * reuse the shop's chrome as code rather than reconstruct it from a
   * description — the only way two independent turns end up with the same
   * contact address and the same returns window.
   */
  chrome?: readonly RecalledSource[];
}

/** A shop from an earlier session that the current prompt is referring to. */
export interface RecalledProjectContext {
  projectId: string;
  name: string;
  summary: string;
  theme: Theme;
  matchedConcepts: string[];
  /** The phrase that dated it, e.g. "yesterday". */
  timePhrase: string | null;
  updatedAt: number;
  /**
   * Components of that shop, read back out of Postgres by the investigation.
   *
   * Absent unless the model actually went and opened them. The theme contract
   * alone answers "the same colours"; only source answers "the same UI", which
   * is the difference between recalling a palette and recalling a page.
   */
  sources?: readonly RecalledSource[];
  /** Which page of that shop the source came from. */
  sourcePageType?: PageType;
}

/**
 * Everything the memory graph contributed to one run, resolved before the model
 * is called. Kept as plain data so the prompt builders and the pipeline stay
 * free of any HydraDB import — the same separation the Anthropic SDK gets.
 */
export interface GenerationMemory {
  inherited: InheritedDesignContext | null;
  recalled: RecalledProjectContext | null;
  /** Files the IMPORTS walk narrowed a refinement to, or null for all of them. */
  contextPaths: string[] | null;
}

export const EMPTY_GENERATION_MEMORY: GenerationMemory = {
  inherited: null,
  recalled: null,
  contextPaths: null,
};

/**
 * One frame of the generation stream. The route serialises these as NDJSON
 * (one JSON object per line) — see `encodeGenerationEvent`.
 */
export type GenerationEvent =
  | { type: "status"; phase: GenerationPhase; message?: string }
  | { type: "memory"; memory: MemoryNotice }
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
  /** Images sent with a user turn, rendered as thumbnails under the message. */
  attachments?: readonly ImageAsset[];
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

/**
 * `public.projects`.
 *
 * A project is a whole shop, not a single page: it can hold a landing page and
 * a product page at once, each with its own version history and its own pointer
 * below. `page_type` is only the page the builder opens on.
 */
export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  page_type: PageType;
  initial_prompt: string;
  current_version_id: string | null;
  landing_version_id: string | null;
  product_version_id: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.versions` — one row per generation, `idx` starts at 1 per page type. */
export interface VersionRecord {
  id: string;
  project_id: string;
  page_type: PageType;
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

/** The newest version of each page type, for booting the builder. */
export type ProjectPages = Record<PageType, VersionRecord | null>;

/** Which page types a project has actually generated. */
export function builtPageTypes(project: ProjectRecord): PageType[] {
  const built: PageType[] = [];
  if (project.landing_version_id) built.push("landing");
  if (project.product_version_id) built.push("product");
  return built;
}

/** The column on `projects` that points at a page type's newest version. */
export const PAGE_TYPE_POINTER: Record<PageType, "landing_version_id" | "product_version_id"> = {
  landing: "landing_version_id",
  product: "product_version_id",
};

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
