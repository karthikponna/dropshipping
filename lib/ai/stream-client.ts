import {
  DEFAULT_META,
  DEFAULT_THEME,
  GENERATION_STREAM_CONTENT_TYPE,
  parseGenerationEvent,
} from "@/lib/types";
import type {
  FileMap,
  GenerateRequestBody,
  GenerationEvent,
  GenerationMeta,
  GenerationPhase,
  Theme,
} from "@/lib/types";

/**
 * Client-side counterpart to `POST /api/generate`. Import this from the builder
 * UI instead of hand-rolling `fetch` + NDJSON framing.
 *
 *   for await (const event of streamGenerationEvents({ body })) { … }
 *
 * or, when you just want the finished tree plus a callback per frame:
 *
 *   const result = await runGenerationStream({ body, onEvent: dispatch });
 *
 * Safe in the browser and on the server: it touches nothing but `fetch`.
 */

export const GENERATE_ENDPOINT = "/api/generate";

export interface GenerationStreamOptions {
  body: GenerateRequestBody;
  /** Abort to cancel the generation; the server stops billing tokens. */
  signal?: AbortSignal;
  /** Override for tests or a proxied deployment. */
  endpoint?: string;
}

type ErrorEvent = Extract<GenerationEvent, { type: "error" }>;

function errorEvent(
  code: ErrorEvent["code"],
  message: string,
  retryable = code !== "aborted",
): ErrorEvent {
  return { type: "error", code, message, retryable };
}

/** Splits an NDJSON byte stream into typed events, tolerant of chunk boundaries. */
export async function* readGenerationEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GenerationEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = parseGenerationEvent(line);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    const tail = parseGenerationEvent(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Opens the stream and yields every event. Failures — including a non-OK
 * response or a dropped connection — arrive as a terminal `error` event rather
 * than a thrown exception, so callers only need one code path.
 */
export async function* streamGenerationEvents(
  options: GenerationStreamOptions,
): AsyncGenerator<GenerationEvent, void, void> {
  const { body, signal, endpoint = GENERATE_ENDPOINT } = options;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: GENERATION_STREAM_CONTENT_TYPE },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) {
      yield errorEvent("aborted", "Generation cancelled.");
      return;
    }
    yield errorEvent(
      "unknown",
      error instanceof Error ? error.message : "Could not reach the generation endpoint.",
    );
    return;
  }

  if (!response.body) {
    yield errorEvent("unknown", `The generation endpoint returned no body (${response.status}).`);
    return;
  }

  let sawTerminal = false;
  try {
    for await (const event of readGenerationEvents(response.body)) {
      if (event.type === "error" || event.type === "done") sawTerminal = true;
      yield event;
    }
  } catch (error) {
    if (signal?.aborted) {
      yield errorEvent("aborted", "Generation cancelled.");
      return;
    }
    yield errorEvent(
      "truncated_stream",
      error instanceof Error ? error.message : "The generation stream ended unexpectedly.",
    );
    return;
  }

  if (sawTerminal) return;

  if (!response.ok) {
    yield errorEvent("unknown", `The generation endpoint failed with ${response.status}.`);
    return;
  }
  yield errorEvent("truncated_stream", "The generation stream ended before it finished.");
}

/* ─────────────────────────── accumulator ──────────────────────────── */

/** Running state of a generation, enough to drive a live preview and a chat rail. */
export interface GenerationStreamState {
  phase: GenerationPhase;
  statusMessage: string | null;
  files: FileMap;
  /** Paths that have opened but not yet completed, oldest first. */
  pending: string[];
  theme: Theme;
  meta: GenerationMeta;
  text: string;
  versionId: string | null;
  projectId: string | null;
  error: ErrorEvent | null;
  done: boolean;
}

export function createGenerationStreamState(base?: {
  files?: FileMap;
  theme?: Theme;
  meta?: GenerationMeta;
}): GenerationStreamState {
  return {
    phase: "connecting",
    statusMessage: null,
    files: { ...(base?.files ?? {}) },
    pending: [],
    theme: base?.theme ?? DEFAULT_THEME,
    meta: base?.meta ?? DEFAULT_META,
    text: "",
    versionId: null,
    projectId: null,
    error: null,
    done: false,
  };
}

/**
 * Folds one event into the state and returns a new object, so it can be used
 * directly as a React reducer.
 */
export function applyGenerationEvent(
  state: GenerationStreamState,
  event: GenerationEvent,
): GenerationStreamState {
  switch (event.type) {
    case "status":
      return { ...state, phase: event.phase, statusMessage: event.message ?? null };
    case "meta":
      return { ...state, meta: event.meta };
    case "theme":
      return { ...state, theme: event.theme };
    case "file_start":
      return {
        ...state,
        files: { ...state.files, [event.path]: state.files[event.path] ?? "" },
        pending: state.pending.includes(event.path) ? state.pending : [...state.pending, event.path],
      };
    case "file_delta":
      return {
        ...state,
        files: { ...state.files, [event.path]: `${state.files[event.path] ?? ""}${event.delta}` },
      };
    case "file_complete":
      return {
        ...state,
        files: { ...state.files, [event.path]: event.content },
        pending: state.pending.filter((path) => path !== event.path),
      };
    case "text":
      return { ...state, text: `${state.text}${event.delta}` };
    case "done":
      return {
        ...state,
        phase: "complete",
        files: event.files,
        pending: [],
        theme: event.theme,
        meta: event.meta,
        versionId: event.versionId ?? null,
        projectId: event.projectId ?? null,
        done: true,
      };
    case "error":
      return { ...state, error: event, done: true };
  }
}

export interface RunGenerationStreamOptions extends GenerationStreamOptions {
  /** Called for every frame, in order, before it is folded into the state. */
  onEvent?: (event: GenerationEvent) => void;
}

/**
 * Consumes the whole stream and resolves with the final state. Never rejects:
 * check `result.error`.
 */
export async function runGenerationStream(
  options: RunGenerationStreamOptions,
): Promise<GenerationStreamState> {
  let state = createGenerationStreamState({
    ...(options.body.baseFiles ? { files: options.body.baseFiles } : {}),
    ...(options.body.baseTheme ? { theme: options.body.baseTheme } : {}),
  });

  for await (const event of streamGenerationEvents(options)) {
    options.onEvent?.(event);
    state = applyGenerationEvent(state, event);
  }

  return state;
}
