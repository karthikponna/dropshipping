"use client";

/**
 * Second line of defence around the preview.
 *
 * Errors in *generated* code cannot reach us: that code runs inside Sandpack's
 * sandboxed iframe and surfaces in its error overlay. This boundary catches the
 * other class of failure — Sandpack itself, the bundler client, or the code
 * editor throwing during render — so a bad generation can never take the
 * dashboard down with it.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { AlertIcon, RefreshIcon } from "./icons";

export interface PreviewErrorBoundaryProps {
  children: ReactNode;
  /** Shown above the error message, e.g. "Preview" or "Code". */
  label?: string;
  /** Change this to clear a caught error — e.g. when a new generation starts. */
  resetKey?: string | number;
  /** Called once per caught error, for logging or telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface PreviewErrorBoundaryState {
  error: Error | null;
}

export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: PreviewErrorBoundaryProps): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-amb-muted p-6">
        <div className="w-full max-w-sm rounded-amb-panel border border-amb-border bg-amb-background p-5 text-center shadow-amb-xs">
          <span className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-amb-row bg-amb-secondary text-amb-destructive">
            <AlertIcon />
          </span>
          <h4 className="text-[15px] font-medium tracking-[-0.01em] text-amb-foreground">
            {this.props.label ?? "Preview"} could not be rendered
          </h4>
          <p className="mt-1.5 text-[13px] leading-relaxed text-amb-muted-foreground">
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-amb-row bg-amb-primary px-3 text-[13px] font-medium text-amb-primary-foreground transition-opacity hover:opacity-90"
            onClick={this.reset}
            type="button"
          >
            <RefreshIcon />
            Try again
          </button>
        </div>
      </div>
    );
  }
}
