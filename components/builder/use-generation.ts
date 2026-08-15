"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyGenerationEvent,
  createGenerationStreamState,
  streamGenerationEvents,
  type GenerationStreamState,
} from "@/lib/ai/stream-client";
import type { FileMap, GenerationMode, PageType, Theme } from "@/lib/types";

/**
 * Drives one generation at a time for the builder page.
 *
 * The stream can emit thousands of `file_delta` frames, so folding every one
 * straight into React state would re-render the chat rail per token. Instead the
 * authoritative state lives in a ref, `file_delta` only schedules a flush on a
 * ~120ms timer, and everything structural (a file opening or closing, a phase
 * change, the terminal frame) flushes immediately. The rail therefore updates
 * promptly on the things a human notices while staying cheap on the things they
 * cannot see.
 *
 * `streamGenerationEvents` never throws — failures arrive as a terminal `error`
 * frame — so there is exactly one settle path, and `onSettled` fires once per
 * run whether it finished, failed or was cancelled.
 */

const FLUSH_INTERVAL_MS = 120;

export interface GenerationRequest {
  mode: GenerationMode;
  /** The description for `create`, or the refinement instruction for `refine`. */
  prompt: string;
  /** The tree the refinement applies to. Required by the route in `refine` mode. */
  baseFiles?: FileMap;
  baseTheme?: Theme;
}

export interface UseGenerationOptions {
  projectId: string;
  pageType: PageType;
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
  touched: string[];
  isStreaming: boolean;
  /** The request behind the most recent run, so a failure can be retried verbatim. */
  lastRequest: GenerationRequest | null;
  start: (request: GenerationRequest) => void;
  cancel: () => void;
}

export function useGeneration({ projectId, pageType, onSettled }: UseGenerationOptions): Generation {
  const [stream, setStream] = useState<GenerationStreamState | null>(null);
  const [touched, setTouched] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastRequest, setLastRequest] = useState<GenerationRequest | null>(null);

  const stateRef = useRef<GenerationStreamState | null>(null);
  const touchedRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const clearFlush = useCallback(() => {
    if (flushRef.current !== null) {
      clearTimeout(flushRef.current);
      flushRef.current = null;
    }
  }, []);

  const flushNow = useCallback(() => {
    clearFlush();
    if (stateRef.current) setStream(stateRef.current);
  }, [clearFlush]);

  const scheduleFlush = useCallback(() => {
    if (flushRef.current !== null) return;
    flushRef.current = setTimeout(() => {
      flushRef.current = null;
      if (stateRef.current) setStream(stateRef.current);
    }, FLUSH_INTERVAL_MS);
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (flushRef.current !== null) clearTimeout(flushRef.current);
    },
    [],
  );

  const start = useCallback(
    (request: GenerationRequest) => {
      // One run at a time: the second click of a double-click is a no-op rather
      // than a second billed stream.
      if (abortRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;

      const initial = createGenerationStreamState({
        ...(request.baseFiles ? { files: request.baseFiles } : {}),
        ...(request.baseTheme ? { theme: request.baseTheme } : {}),
      });
      stateRef.current = initial;
      touchedRef.current = new Set();
      setStream(initial);
      setTouched([]);
      setLastRequest(request);
      setIsStreaming(true);

      void (async () => {
        const events = streamGenerationEvents({
          body: {
            projectId,
            pageType,
            mode: request.mode,
            prompt: request.prompt,
            ...(request.baseFiles ? { baseFiles: request.baseFiles } : {}),
            ...(request.baseTheme ? { baseTheme: request.baseTheme } : {}),
          },
          signal: controller.signal,
        });

        for await (const event of events) {
          stateRef.current = applyGenerationEvent(stateRef.current ?? initial, event);

          if (
            (event.type === "file_start" ||
              event.type === "file_delta" ||
              event.type === "file_complete") &&
            !touchedRef.current.has(event.path)
          ) {
            touchedRef.current.add(event.path);
            setTouched(Array.from(touchedRef.current));
          }

          if (event.type === "file_delta" || event.type === "text") {
            scheduleFlush();
          } else {
            flushNow();
          }
        }

        clearFlush();
        const final = stateRef.current ?? initial;
        setStream(final);
        setIsStreaming(false);
        abortRef.current = null;
        onSettledRef.current(final, request);
      })();
    },
    [clearFlush, flushNow, pageType, projectId, scheduleFlush],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { stream, touched, isStreaming, lastRequest, start, cancel };
}
