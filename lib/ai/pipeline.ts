import { getFramework, missingRequiredFiles } from "@/lib/framework";
import {
  DEFAULT_META,
  DEFAULT_THEME,
  EMPTY_GENERATION_MEMORY,
  GenerationError,
  PAGE_TYPE_LABELS,
} from "@/lib/types";
import type {
  FileMap,
  GenerateRequestBody,
  GenerationEvent,
  GenerationMemory,
  GenerationMeta,
  ImageAsset,
  Investigation,
  MemoryNotice,
  RecalledProjectContext,
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
  /** Uploaded images to show the model with this turn. */
  images?: readonly ImageAsset[];
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
  pageType: GenerateRequestBody["pageType"];
  prompt: string;
  files: FileMap;
  theme: Theme;
  meta: GenerationMeta;
}

/** Returns the new version id, or `null` when there is nowhere to save to. */
export type PipelinePersist = (input: PipelinePersistInput) => Promise<{ versionId: string } | null>;

/** What the memory graph found for this run, plus the notices to show for it. */
export interface ResolvedMemory {
  memory: GenerationMemory;
  notices: readonly MemoryNotice[];
}

export interface RecallOptions {
  /**
   * False once the investigation has already chosen the file set. The heuristic
   * narrowing is the fallback for when Claude did not get to look for itself,
   * and running both would spend a graph round trip to produce a second,
   * worse answer to a question already settled.
   */
  narrowContext: boolean;
}

/**
 * Reads the memory graph. Injected like the model call and the database write,
 * so the pipeline never imports HydraDB and stays runnable offline.
 */
export type PipelineRecall = (
  body: GenerateRequestBody,
  options: RecallOptions,
) => Promise<ResolvedMemory>;

/**
 * Lets Claude query memory itself before a generation is written.
 *
 * Injected for the same reason as the rest, and optional for a stronger one:
 * it costs an extra model round trip, so a caller that cannot afford one — or a
 * graph with nothing in it yet — simply leaves it out and the generation runs
 * the way it always has.
 */
export type PipelineInvestigate = (params: {
  body: GenerateRequestBody;
  /** The past shop recall named, on a create turn that reached backwards. */
  recalled?: RecalledProjectContext | null;
  /** One line per tool call, surfaced live in the chat rail. */
  onStatus: (message: string) => void;
  signal?: AbortSignal;
}) => Promise<Investigation | null>;

/** Records a finished generation in the memory graph. Failures are ignored. */
export type PipelineRemember = (input: {
  versionId: string;
  memory: GenerationMemory;
  files: FileMap;
  theme: Theme;
  meta: GenerationMeta;
}) => Promise<void>;

export interface GenerationPipelineOptions {
  body: GenerateRequestBody;
  write: (event: GenerationEvent) => void;
  streamText: PipelineStreamText;
  persist?: PipelinePersist;
  recall?: PipelineRecall;
  investigate?: PipelineInvestigate;
  remember?: PipelineRemember;
  signal?: AbortSignal;
}

/** Stop reasons that mean the reply was cut off rather than finished. */
const TRUNCATING_STOP_REASONS: readonly string[] = ["max_tokens", "model_context_window_exceeded"];

/** One count with a regular plural, e.g. `3 files` / `1 file`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * What the investigation did, for the chat rail. Memory that works silently
 * reads as the model guessing well, which is the one impression worth avoiding.
 */
export function investigationNotice(investigation: Investigation): MemoryNotice {
  const detail: string[] = [];
  if (investigation.history.length > 0) {
    detail.push(`${count(investigation.history.length, "earlier turn")} in this session`);
  }
  if (investigation.contextPaths) {
    detail.push(`focused on ${count(investigation.contextPaths.length, "file")}`);
  }
  if (investigation.recalledCode) {
    detail.push(`read ${count(investigation.recalledCode.sources.length, "file")} from the earlier shop`);
  }

  return {
    kind: "consulted-graph",
    message: `Checked the memory graph — ${count(investigation.toolCalls, "lookup")}.`,
    ...(detail.length > 0 ? { detail: detail.join(" · ") } : {}),
  };
}

/**
 * That an earlier shop's code is being reused, and whose.
 *
 * Distinct from the notice recall already wrote, which says the graph *found*
 * a shop; this one says its components were opened and are about to be edited.
 * The difference matters to whoever is watching: a recall that names the wrong
 * shop out of three is only visible before the page arrives if the rail says
 * which one it settled on and what it took from it.
 */
export function recalledCodeNotice(
  recalled: RecalledProjectContext,
  code: NonNullable<Investigation["recalledCode"]>,
): MemoryNotice {
  const page = PAGE_TYPE_LABELS[code.pageType].toLowerCase();
  // Named from the code, never from `recalled`. The investigation sees every
  // shop and sometimes settles on a different one than recall proposed; saying
  // "building from X" while the source came from Y is worse than saying nothing.
  const name = code.name.trim().length > 0 ? code.name : recalled.name;
  const switched = code.projectId !== recalled.projectId;

  return {
    kind: "recalled-project",
    message: switched
      ? `Building from "${name}" instead — read ${count(code.sources.length, "file")} of its ${page}.`
      : `Building from "${name}" — read ${count(code.sources.length, "file")} of its ${page}.`,
    detail: code.sources.map((source) => source.path).join(", "),
    projectId: code.projectId,
  };
}

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
  recall,
  investigate,
  remember,
  signal,
}: GenerationPipelineOptions): Promise<void> {
  const framework = getFramework(body.pageType);
  const baseFiles = body.baseFiles ?? {};

  write({ type: "status", phase: "connecting" });

  // A refinement gets to look before it writes: Claude queries the graph for
  // this sitting's earlier turns and this page's components, and opens the files
  // it decides the change touches. That choice is better than any heuristic
  // because it is made after reading what the user asked for three turns ago —
  // but it costs a round trip, so it only runs when there is a graph to ask.
  let investigation: Investigation | null = null;
  if (investigate && body.mode === "refine") {
    write({
      type: "status",
      phase: "investigating",
      message: "Looking through what you have built so far…",
    });
    investigation = await investigate({
      body,
      onStatus: (message) => write({ type: "status", phase: "investigating", message }),
      ...(signal ? { signal } : {}),
    });
    if (investigation) write({ type: "memory", memory: investigationNotice(investigation) });
  }

  // Memory second: what the graph knows changes the prompt, so it has to resolve
  // before the model is called. It is also the only step here allowed to be
  // skipped entirely — an unreachable graph just means no extra context.
  let memory: GenerationMemory = EMPTY_GENERATION_MEMORY;
  if (recall) {
    write({ type: "status", phase: "recalling" });
    const resolved = await recall(body, { narrowContext: investigation?.contextPaths == null });
    memory = resolved.memory;
    for (const notice of resolved.notices) write({ type: "memory", memory: notice });
  }

  // A create turn that reaches backwards gets the same treatment, but only after
  // recall — the investigation's job here is to open an earlier shop's
  // components, and recall is what says which shop that is. Its findings go back
  // into `memory`, so the prompt builder still sees one object.
  if (investigate && body.mode === "create" && memory.recalled) {
    write({
      type: "status",
      phase: "investigating",
      message: "Looking up what you built before…",
    });
    const past = await investigate({
      body,
      recalled: memory.recalled,
      onStatus: (message) => write({ type: "status", phase: "investigating", message }),
      ...(signal ? { signal } : {}),
    });

    if (past) {
      investigation = past;
      // Which shop it settled on beats how many lookups it took to get there,
      // so the naming notice replaces the generic one rather than joining it.
      write({
        type: "memory",
        memory: past.recalledCode
          ? recalledCodeNotice(memory.recalled, past.recalledCode)
          : investigationNotice(past),
      });
      if (past.recalledCode) {
        memory = {
          ...memory,
          recalled: {
            ...memory.recalled,
            sources: past.recalledCode.sources,
            sourcePageType: past.recalledCode.pageType,
          },
        };
      }
    }
  }

  const contextPaths = investigation?.contextPaths ?? memory.contextPaths;

  const attachments = body.attachments ?? [];
  const system = buildSystemPrompt(body.pageType, body.mode, attachments.length > 0);
  const userMessage =
    body.mode === "refine"
      ? buildRefineMessage({
          pageType: body.pageType,
          instruction: body.prompt,
          files: baseFiles,
          theme: body.baseTheme ?? DEFAULT_THEME,
          contextPaths,
          attachments,
          ...(investigation ? { history: investigation.history, plan: investigation.plan } : {}),
        })
      : buildCreateMessage(body.pageType, body.prompt, memory, attachments, investigation?.plan ?? "");

  const parser = new StreamingFileParser();
  let announcedWriting = false;

  write({ type: "status", phase: "planning", message: `Designing your ${framework.label.toLowerCase()}…` });

  const firstPass = await streamText({
    system,
    userMessage,
    maxTokens: GENERATION_MAX_TOKENS,
    ...(attachments.length > 0 ? { images: attachments } : {}),
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
  // A page built on an existing design falls back to that design rather than to
  // the neutral default, so a model that skipped <theme> still comes out
  // matching its sibling page instead of grey.
  let theme: Theme =
    parsed.theme ?? body.baseTheme ?? memory.inherited?.theme ?? memory.recalled?.theme ?? DEFAULT_THEME;
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
      userMessage: buildRepairMessage({ pageType: body.pageType, missing, files, theme, attachments }),
      maxTokens: REPAIR_MAX_TOKENS,
      // The file that went missing may well be the gallery, so the repair pass
      // needs the photos too — this path is rare enough to pay for them twice.
      ...(attachments.length > 0 ? { images: attachments } : {}),
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
      const saved = await persist({
        projectId: body.projectId,
        pageType: body.pageType,
        prompt: body.prompt,
        files,
        theme,
        meta,
      });
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

  // Record the run in the memory graph. This is the last thing that happens and
  // the only step whose failure is silent: the site is already built, saved and
  // on its way to the browser, so a graph write that misses costs the next
  // generation some context and nothing else.
  if (versionId && remember) {
    await remember({ versionId, memory, files, theme, meta });
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
