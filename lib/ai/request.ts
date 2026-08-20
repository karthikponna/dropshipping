import { isModelId } from "@/lib/ai/model";
import { GenerationError, MAX_ATTACHMENTS, isPageType, normalizeTheme } from "@/lib/types";
import type { FileMap, GenerateRequestBody, GenerationMode, ImageAsset, Theme } from "@/lib/types";

/**
 * Validation for the `POST /api/generate` body. Lives here rather than in the
 * route so it can be tested on its own, and so the route file exports nothing
 * but the handler.
 *
 * Everything rejected here throws `bad_request`, which the route turns into a
 * single terminal `error` event with a 400.
 */

export const MAX_PROMPT_CHARS = 4_000;
export const MAX_BASE_FILES = 80;
export const MAX_BASE_FILE_CHARS = 400_000;

function badRequest(message: string): GenerationError {
  return new GenerationError("bad_request", message, { retryable: false });
}

export function parseGenerateRequestBody(raw: unknown): GenerateRequestBody {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("Expected a JSON object body.");
  }

  const input = raw as Record<string, unknown>;

  if (!isPageType(input.pageType)) {
    throw badRequest('pageType must be "landing" or "product".');
  }

  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    throw badRequest("prompt is required — describe the shop you want.");
  }
  const prompt = input.prompt.trim();
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw badRequest(`prompt must be at most ${MAX_PROMPT_CHARS} characters.`);
  }

  if (input.mode !== undefined && input.mode !== "create" && input.mode !== "refine") {
    throw badRequest('mode must be "create" or "refine".');
  }
  const mode: GenerationMode = input.mode === "refine" ? "refine" : "create";

  let projectId: string | undefined;
  if (input.projectId !== undefined && input.projectId !== null) {
    if (typeof input.projectId !== "string" || input.projectId.trim().length === 0) {
      throw badRequest("projectId must be a non-empty string when present.");
    }
    projectId = input.projectId.trim();
  }

  let baseFiles: FileMap | undefined;
  if (input.baseFiles !== undefined && input.baseFiles !== null) {
    if (typeof input.baseFiles !== "object" || Array.isArray(input.baseFiles)) {
      throw badRequest("baseFiles must be an object mapping paths to file contents.");
    }

    const entries = Object.entries(input.baseFiles as Record<string, unknown>);
    if (entries.length > MAX_BASE_FILES) {
      throw badRequest(`baseFiles may contain at most ${MAX_BASE_FILES} files.`);
    }

    let total = 0;
    baseFiles = {};
    for (const [path, contents] of entries) {
      if (typeof contents !== "string") {
        throw badRequest(`baseFiles["${path}"] must be a string.`);
      }
      total += contents.length;
      if (total > MAX_BASE_FILE_CHARS) {
        throw badRequest(`baseFiles must total at most ${MAX_BASE_FILE_CHARS} characters.`);
      }
      baseFiles[path] = contents;
    }
  }

  if (mode === "refine" && (!baseFiles || Object.keys(baseFiles).length === 0)) {
    throw badRequest('mode "refine" requires baseFiles — the tree the change applies to.');
  }

  const baseTheme: Theme | undefined =
    input.baseTheme === undefined || input.baseTheme === null ? undefined : normalizeTheme(input.baseTheme);

  const attachments = parseAttachments(input.attachments);

  // Checked for shape rather than against a fixed list: the models a key can
  // reach are the key's business, and pinning a list here would mean shipping a
  // release every time Anthropic does. An id that is well-formed but does not
  // exist comes back from Anthropic as a 404, which `toGenerationError` names.
  let model: string | undefined;
  if (input.model !== undefined && input.model !== null && input.model !== "") {
    if (!isModelId(input.model)) {
      throw badRequest("model must be an Anthropic model id, e.g. claude-sonnet-5.");
    }
    model = input.model;
  }

  // The session id only ever groups nodes in the memory graph, so a malformed
  // one is dropped rather than rejected: it must never fail a generation.
  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim().length > 0
      ? input.sessionId.trim().slice(0, 100)
      : undefined;

  return {
    pageType: input.pageType,
    prompt,
    mode,
    ...(projectId ? { projectId } : {}),
    ...(baseFiles ? { baseFiles } : {}),
    ...(baseTheme ? { baseTheme } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(model ? { model } : {}),
  };
}

/**
 * Validates the uploaded images a turn carries.
 *
 * These URLs end up in two places that make them worth checking properly: an
 * `<img src>` in code the user will deploy, and a fetch this server performs to
 * show the picture to Claude. So the host must be the storage origin we
 * uploaded to — an arbitrary URL here would otherwise turn the generator into a
 * request forwarder for whatever an attacker wanted fetched.
 */
export function parseAttachments(raw: unknown): ImageAsset[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("attachments must be an array.");
  if (raw.length > MAX_ATTACHMENTS) {
    throw badRequest(`attachments may contain at most ${MAX_ATTACHMENTS} images.`);
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw badRequest(`attachments[${index}] must be an object.`);
    }

    const asset = entry as Record<string, unknown>;
    const url = typeof asset.url === "string" ? asset.url.trim() : "";
    if (!isAllowedAssetUrl(url)) {
      throw badRequest(`attachments[${index}].url must be a shop-assets URL on this project's storage.`);
    }

    const number = (key: string): number => {
      const value = asset[key];
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    };

    return {
      id: text(asset.id, 100) || `attachment-${index}`,
      url,
      path: text(asset.path, 400),
      name: text(asset.name, 200) || `image-${index + 1}`,
      mimeType: text(asset.mimeType, 100) || "image/webp",
      width: number("width"),
      height: number("height"),
      size: number("size"),
    };
  });
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * True for a public URL in this project's own storage bucket.
 *
 * With Supabase unconfigured there is no origin to compare against, which only
 * happens when the generator is being driven locally without a database — in
 * that case any https URL is allowed, because there is no session to abuse.
 */
function isAllowedAssetUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!base) return true;

  try {
    return url.host === new URL(base).host && url.pathname.includes("/shop-assets/");
  } catch {
    return false;
  }
}
