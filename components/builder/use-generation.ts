"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  applyGenerationEvent,
  createGenerationStreamState,
  streamGenerationEvents,
  type GenerationStreamState,
} from "@/lib/ai/stream-client";
import { getSessionId } from "@/lib/session-id";
import type { FileMap, GenerationMode, ImageAsset, PageType, Theme } from "@/lib/types";

/**
 * Drives one generation at a time for the builder page.
 *
 * The run lives in a module-level registry rather than in component state,
 * because the builder unmounts whenever the user visits another dashboard page.
 * Aborting on unmount cost them the whole generation — and the server, which
 * honours the abort, never wrote the version. The run now outlives the
 * component: navigating away leaves it streaming, and coming back re-attaches
 * to it mid-flight instead of starting over.
 *
 * A run that finishes while nothing is mounted needs no special handling, since
 * `POST /api/generate` has already persisted the version by then; the next mount
 * reads it back as ordinary project data.
 *
 * The stream can emit thousands of `file_delta` frames, so folding every one
 * straight into React state would re-render the chat rail per token. The
 * authoritative state lives in the registry, `file_delta` only schedules a flush
 * on a ~120ms timer, and everything structural (a file opening or closing, a
 * phase change, the terminal frame) notifies immediately.
 *
 * `streamGenerationEvents` never throws — failures arrive as a terminal `error`
 * frame — so there is exactly one settle path, and `onSettled` fires once per
 * run for `done`, `error` and `aborted` alike.
 */

const FLUSH_INTERVAL_MS = 120;

export interface GenerationRequest {
  mode: GenerationMode;
  /**
   * Which page of the site this run builds. It belongs to the request rather
   * than the hook because a project holds both page types now, and the user can
   * switch between them while a run is still in flight.
   */
  pageType: PageType;
  /** The description for `create`, or the refinement instruction for `refine`. */
  prompt: string;
  /** The tree the refinement applies to. Required by the route in `refine` mode. */
  baseFiles?: FileMap;
  baseTheme?: Theme;
  /**
   * Photos the user attached, already uploaded. Part of the request so a retry
   * after a failure re-sends the same images rather than silently dropping them.
   */
  attachments?: readonly ImageAsset[];
  /**
   * The Anthropic model chosen in the composer. Held on the request rather than
   * read fresh on retry, so retrying a failure repeats the run that failed
   * instead of quietly switching models under the user.
   */
  model?: string;
}

type SettleHandler = (state: GenerationStreamState, request: GenerationRequest) => void;

interface ActiveRun {
  request: GenerationRequest;
  controller: AbortController;
  state: GenerationStreamState;
  /** Paths this run has written, in arrival order. */
  touched: string[];
  touchedSeen: Set<string>;
  /** Set by the mounted builder, cleared on unmount. Null means nobody is watching. */
  onSettled: SettleHandler | null;
  listeners: Set<() => void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/** Keyed by project id: one in-flight generation per project. */
const activeRuns = new Map<string, ActiveRun>();

function notify(run: ActiveRun): void {
  for (const listener of run.listeners) listener();
}

function clearFlushTimer(run: ActiveRun): void {
  if (run.flushTimer !== null) {
    clearTimeout(run.flushTimer);
    run.flushTimer = null;
  }
}

function scheduleNotify(run: ActiveRun): void {
  if (run.flushTimer !== null) return;
  run.flushTimer = setTimeout(() => {
    run.flushTimer = null;
    notify(run);
  }, FLUSH_INTERVAL_MS);
}

/**
 * The prompt of a run already in flight for this project, if any. Lets a
 * remounting builder put the user's message back in the rail before its first
 * render, rather than showing an empty conversation over a live generation.
 */
export function peekActiveRun(projectId: string): GenerationRequest | null {
  return activeRuns.get(projectId)?.request ?? null;
}

function beginRun(projectId: string, request: GenerationRequest): ActiveRun | null {
  // One run at a time per project: a double-click, a re-mount, or React's
  // development double-effect must not open a second billed stream.
  if (activeRuns.has(projectId)) return null;

  const run: ActiveRun = {
    request,
    controller: new AbortController(),
    state: createGenerationStreamState({
      ...(request.baseFiles ? { files: request.baseFiles } : {}),
      ...(request.baseTheme ? { theme: request.baseTheme } : {}),
    }),
    touched: [],
    touchedSeen: new Set(),
    onSettled: null,
    listeners: new Set(),
    flushTimer: null,
  };
  activeRuns.set(projectId, run);

  void (async () => {
    const events = streamGenerationEvents({
      body: {
        projectId,
        pageType: request.pageType,
        mode: request.mode,
        prompt: request.prompt,
        sessionId: getSessionId(),
        ...(request.model ? { model: request.model } : {}),
        ...(request.baseFiles ? { baseFiles: request.baseFiles } : {}),
        ...(request.baseTheme ? { baseTheme: request.baseTheme } : {}),
        ...(request.attachments && request.attachments.length > 0
          ? { attachments: [...request.attachments] }
          : {}),
      },
      signal: run.controller.signal,
    });

    for await (const event of events) {
      run.state = applyGenerationEvent(run.state, event);

      if (
        (event.type === "file_start" ||
          event.type === "file_delta" ||
          event.type === "file_complete") &&
        !run.touchedSeen.has(event.path)
      ) {
        run.touchedSeen.add(event.path);
        run.touched = [...run.touched, event.path];
      }

      if (event.type === "file_delta" || event.type === "text") {
        scheduleNotify(run);
      } else {
        clearFlushTimer(run);
        notify(run);
      }
    }

    clearFlushTimer(run);
    activeRuns.delete(projectId);

    // Read the handler before notifying: the settle render unsubscribes.
    const settle = run.onSettled;
    notify(run);
    settle?.(run.state, run.request);
  })();

  return run;
}

export interface UseGenerationOptions {
  projectId: string;
  /** Called once per run with the final state, for `done`, `error` and `aborted` alike. */
  onSettled: (state: GenerationStreamState, request: GenerationRequest) => void;
}

export interface Generation {
  /** Live state of the current or most recent run; `null` before the first one. */
  stream: GenerationStreamState | null;
  /**
   * Paths this run actually wrote, in arrival order. `stream.files` cannot answer
   * that in `refine` mode, where it starts pre-seeded with the whole existing
   * tree — and "wrote 2 of 8 files" is the interesting part of a refinement.
   */
  touched: readonly string[];
  isStreaming: boolean;
  /** The request behind the most recent run, so a failure can be retried verbatim. */
  lastRequest: GenerationRequest | null;
  start: (request: GenerationRequest) => void;
  cancel: () => void;
}

export function useGeneration({ projectId, onSettled }: UseGenerationOptions): Generation {
  const [, bump] = useReducer((count: number) => count + 1, 0);

  /** The last finished run, kept so the rail still has something to show. */
  const [settled, setSettled] = useState<{
    state: GenerationStreamState;
    touched: readonly string[];
    request: GenerationRequest;
  } | null>(null);

  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const attachedRef = useRef<ActiveRun | null>(null);

  const attach = useCallback((run: ActiveRun): void => {
    if (attachedRef.current === run) return;
    attachedRef.current = run;

    run.listeners.add(bump);
    run.onSettled = (state, request) => {
      attachedRef.current = null;
      setSettled({ state, touched: run.touched, request });
      onSettledRef.current(state, request);
    };
    bump();
    // `bump` from useReducer is stable for the life of the component.
  }, []);

  /**
   * Adopt a run left behind by a previous mount, so returning to the page
   * mid-generation picks the stream back up.
   */
  useEffect(() => {
    const run = activeRuns.get(projectId);
    if (run) attach(run);
  }, [attach, projectId]);

  /**
   * Detach on unmount — but deliberately do NOT abort. Unmounting means the user
   * navigated to another page, not that they cancelled; the run carries on and
   * the server still writes the version.
   */
  useEffect(
    () => () => {
      const run = attachedRef.current;
      if (!run) return;
      run.listeners.delete(bump);
      run.onSettled = null;
      attachedRef.current = null;
    },
    [],
  );

  const start = useCallback(
    (request: GenerationRequest) => {
      const run = beginRun(projectId, request);
      if (!run) return;
      setSettled(null);
      attach(run);
    },
    [attach, projectId],
  );

  const cancel = useCallback(() => {
    activeRuns.get(projectId)?.controller.abort();
  }, [projectId]);

  const run = activeRuns.get(projectId);

  return {
    stream: run ? run.state : (settled?.state ?? null),
    touched: run ? run.touched : (settled?.touched ?? []),
    isStreaming: run !== undefined,
    lastRequest: run ? run.request : (settled?.request ?? null),
    start,
    cancel,
  };
}
