"use client";

/**
 * Preview + Code panel for the builder page.
 *
 * Wiring in one place, since the streaming behaviour is the subtle part:
 *
 *   files (streamed) ──throttle──▶ committed ──toSandpack──▶ project
 *                                                   │
 *                     fingerprint gate ─────────────┤
 *                                                   ▼
 *                                        one long-lived Sandpack client
 *
 * Three separate guards keep the bundler from being rebuilt on every token:
 * `useCommittedFiles` throttles commits while streaming, the fingerprint gate
 * drops commits that adapt to an identical project, and the Sandpack instance is
 * mounted once and never keyed off the generation, so file changes travel as
 * bundler updates instead of a remount. The Code tab, once opened, also stays
 * mounted for the same reason.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { previewNavigationTarget } from "@/lib/preview/navigation";
import { toSandpack, type SandpackProject } from "@/lib/preview/toSandpack";
import type { FileMap, PageType, PreviewDevice, PreviewTab, Theme } from "@/lib/types";

import { CodePanel } from "./CodePanel";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";
import { PreviewFrame } from "./PreviewFrame";
import { PreviewEmptyState, PreviewLoadingState } from "./PreviewStates";
import { PreviewToolbar } from "./PreviewToolbar";
import type { RouteSwitcherProps } from "./RouteSwitcher";
import { DEFAULT_STREAM_COMMIT_INTERVAL, useCommittedFiles } from "./useCommittedFiles";
import { PREVIEW_PANEL_CSS } from "./theme";

export interface PreviewPanelProps {
  /**
   * The canonical Next.js tree from the generator, keyed by project-relative
   * path (`"app/page.tsx"`). Partial and mid-stream trees are expected: missing
   * or half-written components render as skeletons.
   */
  files?: FileMap;
  /** Theme from the `<theme>` block. Falls back to `files["theme.json"]`, then `DEFAULT_THEME`. */
  theme?: Theme | null;
  /** Shop name, used as the preview document title. */
  title?: string;
  /** Page type, used only to tailor the empty-state copy. */
  pageType?: PageType;
  /** True while a generation streams: throttles commits and shows the indicator. */
  isStreaming?: boolean;

  /**
   * The shop's routes, for the toolbar's route switcher. Supplying this also
   * turns on link following: a click on a cross-page link inside the preview
   * calls `routes.onChange` with the route it pointed at.
   */
  routes?: RouteSwitcherProps;

  /** Controlled tab. Omit to let the panel own it. */
  tab?: PreviewTab;
  onTabChange?: (tab: PreviewTab) => void;
  /** Controlled device. Omit to let the panel own it. */
  device?: PreviewDevice;
  onDeviceChange?: (device: PreviewDevice) => void;

  /** Turns the Code tab into an editor. Requires `onFilesChange` to persist. */
  editable?: boolean;
  /** Debounced callback with the full canonical tree after an edit. */
  onFilesChange?: (files: FileMap) => void;

  /** Rendered at the right end of the toolbar, e.g. an Export .zip button. */
  actions?: ReactNode;
  /**
   * Identity of the thing being previewed (a project id). Changing it boots a
   * fresh bundler and clears a caught render error; leave it stable across the
   * generations of one project.
   */
  previewKey?: string;
  /** Milliseconds between preview commits while streaming. Defaults to 800. */
  streamCommitInterval?: number;
  className?: string;
}

const EMPTY_FILES: FileMap = {};

export function PreviewPanel({
  files = EMPTY_FILES,
  theme = null,
  title,
  pageType,
  isStreaming = false,
  routes,
  tab: tabProp,
  onTabChange,
  device: deviceProp,
  onDeviceChange,
  editable = false,
  onFilesChange,
  actions,
  previewKey,
  streamCommitInterval = DEFAULT_STREAM_COMMIT_INTERVAL,
  className,
}: PreviewPanelProps) {
  const idPrefix = useId();
  const panelIds = useMemo(
    () => ({ preview: `${idPrefix}-preview`, code: `${idPrefix}-code` }),
    [idPrefix],
  );

  const [tabState, setTabState] = useState<PreviewTab>("preview");
  const tab = tabProp ?? tabState;
  const selectTab = (next: PreviewTab): void => {
    setTabState(next);
    onTabChange?.(next);
  };

  const [deviceState, setDeviceState] = useState<PreviewDevice>("desktop");
  const device = deviceProp ?? deviceState;
  const selectDevice = (next: PreviewDevice): void => {
    setDeviceState(next);
    onDeviceChange?.(next);
  };

  // Sandpack (and CodeMirror) touch the DOM on mount and inject their own
  // stylesheet, so nothing Sandpack is rendered during SSR or first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep the Code tab alive once visited so its editor is not rebuilt on every
  // tab switch, but do not pay for it before the user asks.
  const [codeVisited, setCodeVisited] = useState(false);
  useEffect(() => {
    if (tab === "code") setCodeVisited(true);
  }, [tab]);

  // Following a link inside the preview. The sandbox cannot route on its own —
  // it holds one page's tree — so it reports the click and the route changes out
  // here, which is also what the toolbar's switcher does.
  const onRouteChange = routes?.onChange;
  useEffect(() => {
    if (!onRouteChange) return;

    const onMessage = (event: MessageEvent): void => {
      const route = previewNavigationTarget(event.data);
      if (route !== null) onRouteChange(route);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onRouteChange]);

  const committed = useCommittedFiles(files, isStreaming, streamCommitInterval);
  const adapted = useMemo(
    () => toSandpack({ files: committed, theme, title }),
    [committed, theme, title],
  );
  const project = useStableProject(adapted);

  const fileCount = Object.keys(files).length;
  const hasFiles = fileCount > 0;
  const showPreviewFrame = mounted && (hasFiles || isStreaming);

  // An empty route inside a shop that has another page is a slot waiting to be
  // filled, and worth offering to fill. An empty route in an empty project is
  // just an empty project, so the ordinary copy stands.
  const onBuild = routes?.onBuild;
  const emptyRoute =
    routes && onBuild && routes.built.length > 0 && !routes.built.includes(routes.active)
      ? routes.active
      : null;
  const emptyState =
    emptyRoute !== null && onBuild ? (
      <PreviewEmptyState onBuild={() => onBuild(emptyRoute)} pageType={emptyRoute} />
    ) : (
      <PreviewEmptyState pageType={pageType} />
    );

  return (
    <section
      // Deliberately not overflow-hidden: the toolbar's route switcher drops a
      // menu out of it and would be clipped. The panel body clips itself
      // instead, which is all the Sandpack iframe needs.
      className={[
        "flex h-full min-h-0 flex-col rounded-amb-panel border border-amb-border bg-amb-background shadow-amb-xs",
        className ?? "",
      ]
        .join(" ")
        .trimEnd()}
    >
      <style>{PREVIEW_PANEL_CSS}</style>

      <PreviewToolbar
        actions={actions}
        device={device}
        fileCount={fileCount}
        isStreaming={isStreaming}
        onDeviceChange={selectDevice}
        onTabChange={selectTab}
        panelIds={panelIds}
        {...(routes ? { routes } : {})}
        tab={tab}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-amb-panel">
        <div
          className={[
            "absolute inset-0",
            tab === "preview" ? "" : "dsp-panel-hidden pointer-events-none",
          ]
            .join(" ")
            .trimEnd()}
          id={panelIds.preview}
          role="tabpanel"
        >
          {showPreviewFrame ? (
            <PreviewErrorBoundary label="Preview" resetKey={previewKey}>
              <PreviewFrame device={device} instanceId={previewKey} project={project} />
            </PreviewErrorBoundary>
          ) : hasFiles || isStreaming ? (
            <PreviewLoadingState />
          ) : (
            emptyState
          )}
        </div>

        <div
          className={[
            "absolute inset-0",
            tab === "code" ? "" : "dsp-panel-hidden pointer-events-none",
          ]
            .join(" ")
            .trimEnd()}
          id={panelIds.code}
          role="tabpanel"
        >
          {mounted && codeVisited && hasFiles ? (
            <PreviewErrorBoundary label="Code" resetKey={previewKey}>
              <CodePanel editable={editable} files={files} onFilesChange={onFilesChange} />
            </PreviewErrorBoundary>
          ) : hasFiles ? (
            <PreviewLoadingState label="Opening the editor" />
          ) : (
            emptyState
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Holds a project object stable until its content actually changes.
 *
 * `toSandpack` is cheap, but its result is a brand-new object every call, and
 * Sandpack re-derives all of its file state whenever the `files` prop changes
 * identity. Gating on the fingerprint means a re-render caused by, say, a new
 * `theme` object with identical values never reaches the bundler.
 */
function useStableProject(project: SandpackProject): SandpackProject {
  const held = useRef<SandpackProject>(project);
  if (held.current.fingerprint !== project.fingerprint) {
    held.current = project;
  }
  return held.current;
}
