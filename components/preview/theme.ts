/**
 * Sandpack's own chrome (editor, overlays, loading states) is themed through a
 * token object rather than CSS, so the Amboras console values are restated here:
 * white surfaces, #FAFAFA one step off, near-black text, Geist for UI and the
 * console's mono stack for code.
 */

import type { SandpackTheme } from "@codesandbox/sandpack-react";

export const previewSandpackTheme: SandpackTheme = {
  colors: {
    surface1: "#ffffff",
    surface2: "#fafafa",
    surface3: "#f5f5f5",
    disabled: "#a3a3a3",
    base: "#171717",
    clickable: "#737373",
    hover: "#171717",
    accent: "#171717",
    error: "#b91c1c",
    errorSurface: "#fef2f2",
    warning: "#d97706",
    warningSurface: "#fef3c7",
  },
  syntax: {
    plain: "#171717",
    comment: { color: "#a3a3a3", fontStyle: "italic" },
    keyword: "#7c3aed",
    tag: "#0a5e87",
    punctuation: "#737373",
    definition: "#2563eb",
    property: "#b45309",
    static: "#16a34a",
    string: "#16a34a",
  },
  font: {
    body: 'var(--font-geist), "Geist", system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    size: "13px",
    lineHeight: "1.6",
  },
};

/**
 * Overrides for the handful of Sandpack internals that cannot be reached
 * through the theme object. Rendered once by `PreviewPanel`; every rule is
 * scoped under a `dsp-` container class so nothing leaks into the console.
 *
 * The iframe rules matter: Sandpack ships `min-height: 160px; max-height:
 * 2000px` on the preview frame, which fights the device-scaling wrapper (a
 * 390px mobile frame scaled to 40% needs to be far taller than 2000px to fill
 * the panel).
 */
export const PREVIEW_PANEL_CSS = `
/* CSS visibility is inherited, but a descendant may override it — and Sandpack
   sets \`visibility: visible\` on its own tab panels. That defeated hiding the
   inactive panel with \`visibility: hidden\` alone: the code editor kept
   painting over the preview iframe stacked beneath it. Force the whole subtree
   back to hidden so the inactive tab cannot draw. */
.dsp-panel-hidden,
.dsp-panel-hidden * { visibility: hidden !important; }
.dsp-preview .sp-wrapper,
.dsp-preview .sp-stack,
.dsp-preview .sp-preview-container { height: 100%; }
.dsp-preview .sp-preview-iframe {
  height: 100%;
  min-height: 0;
  max-height: none;
  background-color: #ffffff;
}
.dsp-preview .sp-overlay,
.dsp-preview .sp-error { font-size: 12px; }
.dsp-code .sp-wrapper,
.dsp-code .sp-stack,
.dsp-code .sp-editor { height: 100%; }
.dsp-code .sp-code-editor { height: 100%; }
.dsp-code .cm-editor { height: 100%; }
.dsp-code .cm-gutters { background-color: #ffffff; border-right: 1px solid rgba(0, 0, 0, 0.06); }
.dsp-code .cm-scroller { overflow: auto; }
`;
