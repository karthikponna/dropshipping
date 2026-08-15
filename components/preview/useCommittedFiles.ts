"use client";

import { useEffect, useRef, useState } from "react";

import type { FileMap } from "@/lib/types";

/** Trailing-throttle window for preview commits while a generation streams. */
export const DEFAULT_STREAM_COMMIT_INTERVAL = 800;

/**
 * Gates a streaming FileMap so the bundler is handed at most one new tree per
 * `interval`, then flushed immediately when the stream ends.
 *
 * `/api/generate` emits a `file_delta` per token, so the raw FileMap changes
 * identity dozens of times a second. Sandpack re-derives its whole file state
 * whenever the `files` prop changes identity, so feeding it the raw stream would
 * mean a bundler write per token — unusable. Throttling here (rather than
 * relying only on Sandpack's `recompileDelay`) also keeps React from rebuilding
 * the adapted project on every tick.
 */
export function useCommittedFiles(
  files: FileMap,
  isStreaming: boolean,
  interval: number = DEFAULT_STREAM_COMMIT_INTERVAL,
): FileMap {
  const [committed, setCommitted] = useState<FileMap>(files);
  const lastCommitAt = useRef<number>(0);

  useEffect(() => {
    const commit = (): void => {
      lastCommitAt.current = Date.now();
      setCommitted((previous) => (previous === files ? previous : files));
    };

    if (!isStreaming) {
      commit();
      return;
    }

    const wait = Math.max(0, interval - (Date.now() - lastCommitAt.current));
    const timer = window.setTimeout(commit, wait);
    return () => window.clearTimeout(timer);
  }, [files, isStreaming, interval]);

  return committed;
}
