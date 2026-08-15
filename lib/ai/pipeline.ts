import { getFramework, missingRequiredFiles } from "@/lib/framework";
import { DEFAULT_META, DEFAULT_THEME, GenerationError } from "@/lib/types";
import type {
  FileMap,
  GenerateRequestBody,
  GenerationEvent,
  GenerationMeta,
  Theme,
} from "@/lib/types";

import { StreamingFileParser } from "./parser";
import { GENERATION_MAX_TOKENS, REPAIR_MAX_TOKENS } from "./model";
import { buildCreateMessage, buildRefineMessage, buildRepairMessage, buildSystemPrompt } from "./prompts";

/**
 * The generation pipeline: prompt → stream → parse → validate → repair → save.
 *
 * The model call and the database write are injected rather than imported, which
 * keeps this file free of the Anthropic SDK and of `next/headers` — so the whole
 * sequence, including the repair pass and the refine merge, can be exercised
 * offline against a fake model. `app/api/generate/route.ts` supplies the real
 * implementations.
 */

export interface PipelineStreamParams {
  system: string;
  userMessage: string;
  maxTokens: number;
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void;
}

export interface PipelineStreamResult {
  /** Anthropic's `stop_reason`; `"max_tokens"` means the model was cut off. */
  stopReason: string | null;
}

export type PipelineStreamText = (params: PipelineStreamParams) => Promise<PipelineStreamResult>;

export interface PipelinePersistInput {
  projectId: string;
  prompt: string;
  files: FileMap;
  theme: Theme;
  meta: GenerationMeta;
}

/** Returns the new version id, or `null` when there is nowhere to save to. */
export type PipelinePersist = (input: PipelinePersistInput) => Promise<{ versionId: string } | null>;

export interface GenerationPipelineOptions {
  body: GenerateRequestBody;
  write: (event: GenerationEvent) => void;
  streamText: PipelineStreamText;
  persist?: PipelinePersist;
  signal?: AbortSignal;
}

/** Stop reasons that mean the reply was cut off rather than finished. */
const TRUNCATING_STOP_REASONS: readonly string[] = ["max_tokens", "model_context_window_exceeded"];

/** A stand-in `<meta>` for the rare case the model skips the block entirely. */
export function fallbackMeta(prompt: string): GenerationMeta {
  const firstSentence = prompt.split(/[.!?\n]/, 1)[0]?.trim() ?? "";
  const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return {
    name: words.length > 0 ? words : DEFAULT_META.name,
    summary: prompt.slice(0, 160),
  };
}

/**
 * Runs one generation to completion, writing every event as it happens. Throws a
 * `GenerationError` on failure; the caller turns that into the terminal `error`
 * event so there is exactly one place that ends a stream badly.
 */
export async function runGenerationPipeline({
  body,
  write,
  streamText,
  persist,
  signal,
}: GenerationPipelineOptions): Promise<void> {
  const framework = getFramework(body.pageType);
  const baseFiles = body.baseFiles ?? {};

  write({ type: "status", phase: "connecting" });

  const system = buildSystemPrompt(body.pageType, body.mode);
  const userMessage =
    body.mode === "refine"
      ? buildRefineMessage({
          pageType: body.pageType,
          instruction: body.prompt,
          files: baseFiles,
          theme: body.baseTheme ?? DEFAULT_THEME,
        })
      : buildCreateMessage(body.pageType, body.prompt);

  const parser = new StreamingFileParser();
  let announcedWriting = false;

  write({ type: "status", phase: "planning", message: `Designing your ${framework.label.toLowerCase()}…` });

  const firstPass = await streamText({
    system,
    userMessage,
    maxTokens: GENERATION_MAX_TOKENS,
    ...(signal ? { signal } : {}),
    onTextDelta: (delta) => {
      for (const event of parser.push(delta)) {
        if (!announcedWriting && (event.type === "file_start" || event.type === "file_delta")) {
          announcedWriting = true;
          write({ type: "status", phase: "writing" });
        }
        write(event);
      }
    },
  });
  for (const event of parser.finish()) write(event);

  const parsed = parser.result;
  let files: FileMap = { ...baseFiles, ...parsed.files };
  let theme: Theme = parsed.theme ?? body.baseTheme ?? DEFAULT_THEME;
  const meta: GenerationMeta = parsed.meta ?? fallbackMeta(body.prompt);
  const truncated =
    parsed.truncated || (firstPass.stopReason !== null && TRUNCATING_STOP_REASONS.includes(firstPass.stopReason));

  if (!parsed.theme) write({ type: "theme", theme });
  if (!parsed.meta) write({ type: "meta", meta });

  let missing = missingRequiredFiles(body.pageType, files);

  if (missing.length > 0) {
    // One targeted pass for exactly the missing paths — never a full regeneration.
    write({
      type: "status",
      phase: "repairing",
      message: `Finishing ${missing.length} missing file${missing.length === 1 ? "" : "s"}…`,
    });

    const repairParser = new StreamingFileParser();
    await streamText({
      system,
      userMessage: buildRepairMessage({ pageType: body.pageType, missing, files, theme }),
      maxTokens: REPAIR_MAX_TOKENS,
      ...(signal ? { signal } : {}),
      onTextDelta: (delta) => {
        for (const event of repairParser.push(delta)) write(event);
      },
    });
    for (const event of repairParser.finish()) write(event);

    const repaired = repairParser.result;
    files = { ...files, ...repaired.files };
    if (!parsed.theme && repaired.theme) {
      theme = repaired.theme;
      write({ type: "theme", theme });
    }

    missing = missingRequiredFiles(body.pageType, files);
    if (missing.length > 0) {
      throw new GenerationError(
        truncated || repaired.truncated ? "truncated_stream" : "missing_files",
        `The model stopped before finishing ${missing.join(", ")}. Try again, or shorten the description.`,
      );
    }
  }

  write({ type: "status", phase: "saving" });

  let versionId: string | undefined;
  if (body.projectId && persist) {
    try {
      const saved = await persist({ projectId: body.projectId, prompt: body.prompt, files, theme, meta });
      if (saved) versionId = saved.versionId;
    } catch (error) {
      // Ownership and cancellation are real failures. A flaky database is not
      // worth throwing away a finished site the client can still preview.
      if (error instanceof GenerationError && (error.code === "unauthorized" || error.code === "aborted")) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "the database rejected the write";
      write({ type: "status", phase: "saving", message: `Not saved to history — ${message}` });
    }
  }

  write({ type: "status", phase: "complete" });
  write({
    type: "done",
    files,
    theme,
    meta,
    ...(versionId ? { versionId } : {}),
    ...(body.projectId ? { projectId: body.projectId } : {}),
  });
}
