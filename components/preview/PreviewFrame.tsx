"use client";

/**
 * The Sandpack half of the panel: one long-lived bundler client, scaled to the
 * selected device width.
 */

import { SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { PREVIEW_DEVICE_WIDTHS, type PreviewDevice } from "@/lib/types";
import type { SandpackProject } from "@/lib/preview/toSandpack";

import { previewSandpackTheme } from "./theme";

export interface PreviewFrameProps {
  /** Output of `toSandpack`. Keep its identity stable between real changes. */
  project: SandpackProject;
  /** Which device width to emulate. */
  device: PreviewDevice;
  /**
   * Sandpack instance id. Changing it tears down the bundler and boots a new
   * one, so it should only change per project — never per generation.
   */
  instanceId?: string;
}

interface Box {
  width: number;
  height: number;
}

const EMPTY_BOX: Box = { width: 0, height: 0 };

export function PreviewFrame({ project, device, instanceId }: PreviewFrameProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box>(EMPTY_BOX);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (node === null) return;

    const measure = (): void => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setBox((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const deviceWidth = PREVIEW_DEVICE_WIDTHS[device];
  const measured = box.width > 0 && box.height > 0;

  // Scale down to fit rather than letting the frame overflow horizontally.
  const scale = measured ? Math.min(1, box.width / deviceWidth) : 1;
  const frameHeight = measured ? Math.max(320, Math.round(box.height / scale)) : 640;
  const offsetX = measured ? Math.max(0, Math.round((box.width - deviceWidth * scale) / 2)) : 0;

  const options = useMemo(
    () => ({
      activeFile: project.activeFile,
      initMode: "immediate" as const,
      // Sandpack coalesces file writes on its own side too; together with the
      // committed-files throttle this keeps the bundler quiet while streaming.
      recompileMode: "delayed" as const,
      recompileDelay: 400,
      bundlerTimeOut: 120_000,
      ...(instanceId === undefined ? {} : { id: instanceId }),
    }),
    [project.activeFile, instanceId],
  );

  return (
    <div className="dsp-preview relative h-full w-full overflow-hidden bg-amb-muted" ref={viewportRef}>
      <div
        className="absolute left-0 top-0 origin-top-left overflow-hidden border-x border-b border-amb-border bg-amb-background"
        style={{
          height: `${frameHeight}px`,
          transform: `translateX(${offsetX}px) scale(${scale})`,
          width: `${deviceWidth}px`,
        }}
      >
        <SandpackProvider
          files={project.files}
          options={options}
          style={{ height: "100%" }}
          template={project.template}
          theme={previewSandpackTheme}
        >
          <SandpackPreview
            showNavigator={false}
            showOpenInCodeSandbox={false}
            showRefreshButton={false}
            showRestartButton={false}
            showSandpackErrorOverlay
            style={{ height: "100%" }}
          />
        </SandpackProvider>
      </div>
    </div>
  );
}
