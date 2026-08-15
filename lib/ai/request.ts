import { GenerationError, isPageType, normalizeTheme } from "@/lib/types";
import type { FileMap, GenerateRequestBody, GenerationMode, Theme } from "@/lib/types";

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

  return {
    pageType: input.pageType,
    prompt,
    mode,
    ...(projectId ? { projectId } : {}),
    ...(baseFiles ? { baseFiles } : {}),
    ...(baseTheme ? { baseTheme } : {}),
  };
}
