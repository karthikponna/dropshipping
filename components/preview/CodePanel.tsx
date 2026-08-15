"use client";

/**
 * The Code tab.
 *
 * It deliberately shows the *canonical* Next.js tree — `app/page.tsx` importing
 * `@/components/Hero` — and not the adapted preview tree. That canonical tree is
 * what gets stored, restored and exported as a zip, so it is the only version
 * the user should ever read or copy. The preview shims (`../shims/next-image`,
 * `App.tsx`) are an implementation detail of the bundler and stay hidden.
 *
 * A second, non-running Sandpack instance backs the editor: no template, no
 * client, `autorun` off — it is only here for CodeMirror and its file state.
 */

import {
  SandpackCodeEditor,
  SandpackProvider,
  useActiveCode,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { FileMap } from "@/lib/types";

import { CheckIcon, CopyIcon, FileIcon } from "./icons";
import { previewSandpackTheme } from "./theme";

export interface CodePanelProps {
  /** Canonical Next.js tree, exactly as generated and stored. */
  files: FileMap;
  /** Allow editing. Off by default: the tree is a generated artefact. */
  editable?: boolean;
  /**
   * Called (debounced) with the full tree after an edit. Only set this together
   * with `editable`; treat it as a save-back, not as a re-render trigger, since
   * feeding the result straight back in resets the editor's file state.
   */
  onFilesChange?: (files: FileMap) => void;
  className?: string;
}

/** Entry first, then components, then everything else — both groups sorted. */
function orderPaths(paths: readonly string[]): string[] {
  const weight = (path: string): number => {
    if (path === "app/page.tsx") return 0;
    if (path.startsWith("app/")) return 1;
    if (path.startsWith("components/")) return 2;
    if (path.startsWith("lib/")) return 3;
    if (path.endsWith(".json")) return 5;
    return 4;
  };
  return [...paths].sort((left, right) => {
    const difference = weight(left) - weight(right);
    return difference === 0 ? left.localeCompare(right) : difference;
  });
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "/" : path.slice(0, index);
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function CodePanel({ files, editable = false, onFilesChange, className }: CodePanelProps) {
  const paths = useMemo(() => orderPaths(Object.keys(files)), [files]);

  const sandpackFiles = useMemo(() => {
    const mapped: Record<string, { code: string }> = {};
    for (const path of paths) mapped[`/${path}`] = { code: files[path] };
    return mapped;
  }, [files, paths]);

  const activeFile = paths.length > 0 ? `/${paths[0]}` : undefined;

  // Sandpack rebuilds its whole file state whenever `files`, `customSetup` or
  // `template` change identity, which would drop the editor's cursor and any
  // unsaved edit on every parent re-render. Hence the memos.
  const customSetup = useMemo(() => ({ entry: activeFile }), [activeFile]);
  const options = useMemo(
    () => ({
      activeFile,
      autoReload: false,
      autorun: false,
      initMode: "immediate" as const,
      visibleFiles: paths.map((path) => `/${path}`),
    }),
    [activeFile, paths],
  );

  if (paths.length === 0) return null;

  return (
    <div className={`dsp-code flex h-full min-h-0 w-full ${className ?? ""}`.trimEnd()}>
      <SandpackProvider
        customSetup={customSetup}
        files={sandpackFiles}
        options={options}
        style={{ display: "flex", height: "100%", minHeight: 0, width: "100%" }}
        theme={previewSandpackTheme}
      >
        <FileTree paths={paths} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <FileHeader editable={editable} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <SandpackCodeEditor
              readOnly={!editable}
              showInlineErrors={false}
              showLineNumbers
              showReadOnly={false}
              showRunButton={false}
              showTabs={false}
              style={{ height: "100%" }}
              wrapContent={false}
            />
          </div>
        </div>
        {editable && onFilesChange ? <EditBridge onFilesChange={onFilesChange} paths={paths} /> : null}
      </SandpackProvider>
    </div>
  );
}

function FileTree({ paths }: { paths: readonly string[] }) {
  const { sandpack } = useSandpack();

  const groups = useMemo(() => {
    const byDirectory = new Map<string, string[]>();
    for (const path of paths) {
      const directory = directoryOf(path);
      const list = byDirectory.get(directory) ?? [];
      list.push(path);
      byDirectory.set(directory, list);
    }
    return Array.from(byDirectory.entries());
  }, [paths]);

  return (
    <nav
      aria-label="Generated files"
      className="h-full w-52 shrink-0 overflow-y-auto border-r border-amb-border bg-amb-muted px-2 py-2.5"
    >
      {groups.map(([directory, group]) => (
        <div className="mb-2 last:mb-0" key={directory}>
          <p className="px-2 pb-1 font-amb-mono text-[10px] uppercase tracking-[0.08em] text-amb-muted-foreground">
            {directory === "/" ? "root" : directory}
          </p>
          {group.map((path) => {
            const isActive = sandpack.activeFile === `/${path}`;
            return (
              <button
                aria-current={isActive ? "true" : undefined}
                className={[
                  "flex h-8 w-full items-center gap-2 rounded-amb-row px-2 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-amb-nav-active-bg font-medium text-amb-foreground"
                    : "text-amb-nav-idle hover:bg-amb-sidebar-accent hover:text-amb-foreground",
                ].join(" ")}
                key={path}
                onClick={() => sandpack.setActiveFile(`/${path}`)}
                title={path}
                type="button"
              >
                <FileIcon className="shrink-0 opacity-70" height="14" width="14" />
                <span className="truncate">{fileNameOf(path)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function FileHeader({ editable }: { editable: boolean }) {
  const { sandpack } = useSandpack();
  const { code } = useActiveCode();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = async (): Promise<void> => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      copied = false;
    }
    setState(copied ? "copied" : "failed");
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), 1800);
  };

  const path = sandpack.activeFile.replace(/^\//, "");

  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-amb-border bg-amb-background px-3">
      <p className="truncate font-amb-mono text-[12px] text-amb-muted-foreground" title={path}>
        {path}
      </p>
      <div className="flex items-center gap-2">
        {editable ? null : (
          <span className="rounded-full bg-amb-secondary px-2 py-0.5 text-[11px] text-amb-muted-foreground">
            Read only
          </span>
        )}
        <button
          className="inline-flex h-7 items-center gap-1.5 rounded-amb-row border border-amb-border bg-amb-background px-2.5 text-[12px] font-medium text-amb-foreground transition-colors hover:bg-amb-muted"
          onClick={() => {
            void copy();
          }}
          type="button"
        >
          {state === "copied" ? <CheckIcon height="14" width="14" /> : <CopyIcon height="14" width="14" />}
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy file"}
        </button>
      </div>
    </div>
  );
}

/**
 * Reports editor changes back out, debounced, and only for the paths that came
 * in as props (Sandpack adds a synthetic `package.json` of its own).
 */
function EditBridge({
  paths,
  onFilesChange,
}: {
  paths: readonly string[];
  onFilesChange: (files: FileMap) => void;
}) {
  const { sandpack } = useSandpack();
  const emitted = useRef<string | null>(null);
  const callback = useRef(onFilesChange);

  useEffect(() => {
    callback.current = onFilesChange;
  }, [onFilesChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next: FileMap = {};
      for (const path of paths) {
        const file = sandpack.files[`/${path}`];
        if (file !== undefined) next[path] = file.code;
      }

      const serialized = JSON.stringify(next);
      if (emitted.current === null) {
        emitted.current = serialized;
        return;
      }
      if (emitted.current === serialized) return;
      emitted.current = serialized;
      callback.current(next);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [paths, sandpack.files]);

  return null;
}
