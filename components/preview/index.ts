/**
 * Public API of the preview panel.
 *
 * The builder page needs only `PreviewPanel`:
 *
 * ```tsx
 * <PreviewPanel
 *   files={files}
 *   theme={theme}
 *   title={project.name}
 *   pageType={project.page_type}
 *   isStreaming={isGenerating}
 *   previewKey={project.id}
 *   actions={<ExportButton />}
 * />
 * ```
 *
 * The pieces below it are exported for the cases where that is not enough — a
 * preview without chrome, a standalone code view, or the streaming throttle on
 * its own. The Next.js → Sandpack adapter itself lives in
 * `@/lib/preview/toSandpack`.
 */

export { PreviewPanel } from "./PreviewPanel";
export type { PreviewPanelProps } from "./PreviewPanel";

export { PreviewFrame } from "./PreviewFrame";
export type { PreviewFrameProps } from "./PreviewFrame";

export { CodePanel } from "./CodePanel";
export type { CodePanelProps } from "./CodePanel";

export { PreviewToolbar } from "./PreviewToolbar";
export type { PreviewToolbarProps } from "./PreviewToolbar";

export { RouteSwitcher } from "./RouteSwitcher";
export type { RouteSwitcherProps } from "./RouteSwitcher";

export { PreviewEmptyState, PreviewLoadingState } from "./PreviewStates";
export type { PreviewEmptyStateProps } from "./PreviewStates";

export { PreviewErrorBoundary } from "./PreviewErrorBoundary";
export type { PreviewErrorBoundaryProps } from "./PreviewErrorBoundary";

export { DEFAULT_STREAM_COMMIT_INTERVAL, useCommittedFiles } from "./useCommittedFiles";

export { PREVIEW_PANEL_CSS, previewSandpackTheme } from "./theme";
