"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { PreviewPanel } from "@/components/preview";
import type { GenerationStreamState } from "@/lib/ai/stream-client";
import { cx } from "@/lib/dashboard/format";
import { PAGE_TYPE_LABELS } from "@/lib/types";
import type {
  ChatMessage,
  FileMap,
  GenerationMode,
  PreviewDevice,
  PreviewTab,
  ProjectRecord,
  ProjectWithVersion,
  Theme,
  VersionRecord,
  VersionSummary,
} from "@/lib/types";

import { ChatRail } from "./chat-rail";
import { ExportButton } from "./export-button";
import { ChatIcon, ScreenIcon } from "./icons";
import { useGeneration, type GenerationRequest } from "./use-generation";
import { VersionHistory } from "./version-history";

/**
 * The builder: conversation on the left, live preview on the right.
 *
 * This component owns the one authoritative copy of the generated tree. While a
 * run streams, the preview reads the stream's partial tree instead; on `done` the
 * finished tree is committed here and the stream becomes history.
 *
 * Persistence deliberately happens nowhere in this file. `POST /api/generate`
 * writes the `versions` row and moves `projects.current_version_id` as part of
 * finishing a generation — it already holds the files and has done the ownership
 * check — and reports the new id back on the `done` frame. The builder only reads
 * history (`GET /api/projects/[id]/versions`) and, for a restore, moves the
 * pointer (`PATCH /api/projects/[id]`). Writing a version from here as well is
 * exactly how you end up with two rows per generation.
 */

export interface BuilderWorkspaceProps {
  project: ProjectRecord;
  /** The version being previewed on arrival, or null for a project that has never run. */
  initialVersion: VersionRecord | null;
  initialVersions: readonly VersionSummary[];
  /** `?autostart=1` from the dashboard dock: generate immediately, once. */
  autostart: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" } as const;

export function BuilderWorkspace({
  project,
  initialVersion,
  initialVersions,
  autostart,
}: BuilderWorkspaceProps) {
  const router = useRouter();

  const [files, setFiles] = useState<FileMap>(initialVersion?.files ?? {});
  const [theme, setTheme] = useState<Theme | null>(initialVersion?.theme ?? null);
  const [shopName, setShopName] = useState(project.name);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    seedMessages(initialVersions, project),
  );

  const [versions, setVersions] = useState<readonly VersionSummary[]>(initialVersions);
  const [currentVersionId, setCurrentVersionId] = useState(project.current_version_id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [tab, setTab] = useState<PreviewTab>("preview");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");

  const hasFiles = Object.keys(files).length > 0;

  const refreshVersions = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/projects/${project.id}/versions`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { versions?: VersionSummary[] };
      if (payload.versions) setVersions(payload.versions);
    } catch {
      // The history list is a nicety; a failed refresh must not disturb the build.
    }
  }, [project.id]);

  const onSettled = useCallback(
    (state: GenerationStreamState, request: GenerationRequest): void => {
      if (state.error) {
        const { code, message, retryable } = state.error;

        setMessages((current) => [
          ...current,
          code === "aborted"
            ? note("Generation cancelled. Nothing was saved.")
            : {
                id: nextId("error"),
                role: "assistant",
                content: message,
                createdAt: new Date().toISOString(),
                status: "error",
                errorCode: code,
                retryable,
              },
        ]);

        // A first generation that died halfway is still worth previewing; a
        // failed refinement must not replace a site that already works.
        if (!hasFiles && Object.keys(state.files).length > 0) {
          setFiles(state.files);
          setTheme(state.theme);
        }
        return;
      }

      setFiles(state.files);
      setTheme(state.theme);
      if (state.meta.name.trim().length > 0) setShopName(state.meta.name.trim());

      const changed = changedPaths(state.files, request.baseFiles);
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "assistant",
          content: summarize({
            mode: request.mode,
            name: state.meta.name,
            summary: state.meta.summary,
            changed: changed.length,
            saved: state.versionId !== null,
          }),
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ]);

      if (state.versionId) {
        setCurrentVersionId(state.versionId);
        void refreshVersions();
        // The dashboard's project list, counters and derived name read from the
        // server, so let them re-render with the row this run just wrote.
        router.refresh();
      }
    },
    [hasFiles, refreshVersions, router],
  );

  const generation = useGeneration({
    projectId: project.id,
    pageType: project.page_type,
    onSettled,
  });

  const send = useCallback(
    (instruction: string): void => {
      const mode: GenerationMode = hasFiles ? "refine" : "create";

      setMessages((current) => [
        ...current,
        {
          id: nextId("user"),
          role: "user",
          content: instruction,
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ]);

      generation.start({
        mode,
        prompt: instruction,
        ...(mode === "refine" ? { baseFiles: files, ...(theme ? { baseTheme: theme } : {}) } : {}),
      });
    },
    [files, generation, hasFiles, theme],
  );

  const retry = useCallback((): void => {
    const request = generation.lastRequest;
    if (!request || generation.isStreaming) return;
    generation.start(request);
  }, [generation]);

  /**
   * The dock creates the project row with no version and forwards here with
   * `?autostart=1`. Strip the parameter as soon as it has been acted on, so a
   * refresh — or the back button — cannot start a second generation.
   */
  const autostartedRef = useRef(false);
  useEffect(() => {
    if (!autostart || autostartedRef.current) return;
    autostartedRef.current = true;

    window.history.replaceState(null, "", window.location.pathname);

    if (hasFiles || generation.isStreaming) return;
    send(project.initial_prompt);
    // `send` and `hasFiles` change with every generation; this must run once, on
    // the arrival that carried the parameter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart]);

  const restore = useCallback(
    async (versionId: string): Promise<void> => {
      setRestoringId(versionId);
      setHistoryError(null);

      try {
        const patched = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ currentVersionId: versionId }),
        });
        if (!patched.ok) throw new Error(await readError(patched));

        // The history list omits `files` for weight, so read the project back to
        // get the restored version's tree.
        const reloaded = await fetch(`/api/projects/${project.id}`, {
          headers: { Accept: "application/json" },
        });
        if (!reloaded.ok) throw new Error(await readError(reloaded));

        const payload = (await reloaded.json()) as { project?: ProjectWithVersion };
        const version = payload.project?.current_version;
        if (!version) throw new Error("That version could not be loaded.");

        setFiles(version.files);
        setTheme(version.theme);
        setCurrentVersionId(version.id);
        setMessages((current) => [...current, note(`Restored v${version.idx}.`)]);
        setHistoryOpen(false);
        router.refresh();
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : "The restore failed.");
      } finally {
        setRestoringId(null);
      }
    },
    [project.id, router],
  );

  const previewFiles = generation.isStreaming && generation.stream ? generation.stream.files : files;
  const previewTheme =
    generation.isStreaming && generation.stream ? generation.stream.theme : (theme ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4">
      <div
        aria-label="Builder pane"
        className="flex shrink-0 items-center gap-0.5 self-start rounded-amb-row border border-amb-border bg-amb-muted p-0.5 md:hidden"
        role="group"
      >
        {(
          [
            { id: "chat", label: "Chat", Icon: ChatIcon },
            { id: "preview", label: "Preview", Icon: ScreenIcon },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            aria-pressed={mobilePane === id}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors",
              mobilePane === id
                ? "bg-amb-background text-amb-foreground shadow-amb-xs"
                : "text-amb-muted-foreground",
            )}
            key={id}
            onClick={() => setMobilePane(id)}
            type="button"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(300px,340px)_1fr] lg:gap-4 xl:grid-cols-[400px_1fr]">
        {/* min-w-0: without it an auto grid track is sized by the pane's
            min-content width, and the preview toolbar is wider than a phone. */}
        <div className={cx("min-h-0 min-w-0", mobilePane === "chat" ? "" : "hidden md:block")}>
          <ChatRail
            hasFiles={hasFiles}
            initialDraft={autostart || initialVersion !== null ? "" : project.initial_prompt}
            isStreaming={generation.isStreaming}
            messages={messages}
            onCancel={generation.cancel}
            onOpenHistory={() => setHistoryOpen(true)}
            onRetry={retry}
            onSubmit={send}
            pageType={project.page_type}
            projectName={shopName}
            stream={generation.stream}
            touched={generation.touched}
            versionCount={versions.length}
          />
        </div>

        <div className={cx("min-h-0 min-w-0", mobilePane === "preview" ? "" : "hidden md:block")}>
          <PreviewPanel
            actions={
              <ExportButton
                files={files}
                name={shopName}
                pageType={project.page_type}
                prompt={project.initial_prompt}
                theme={theme}
              />
            }
            device={device}
            files={previewFiles}
            isStreaming={generation.isStreaming}
            onDeviceChange={setDevice}
            onTabChange={setTab}
            pageType={project.page_type}
            previewKey={project.id}
            tab={tab}
            theme={previewTheme}
            title={shopName}
          />
        </div>
      </div>

      <VersionHistory
        currentVersionId={currentVersionId}
        error={historyError}
        onClose={() => setHistoryOpen(false)}
        onRestore={(versionId) => void restore(versionId)}
        open={historyOpen}
        restoringId={restoringId}
        versions={versions}
      />
    </div>
  );
}

/* ──────────────────────────────── helpers ──────────────────────────────── */

let messageSequence = 0;

function nextId(prefix: string): string {
  messageSequence += 1;
  return `${prefix}-${messageSequence}`;
}

function note(content: string): ChatMessage {
  return {
    id: nextId("note"),
    role: "system",
    content,
    createdAt: new Date().toISOString(),
    status: "complete",
  };
}

/**
 * Rebuilds the conversation from saved versions: each row stores the prompt that
 * produced it, so the rail survives a reload without a separate messages table.
 */
function seedMessages(
  versions: readonly VersionSummary[],
  project: ProjectRecord,
): ChatMessage[] {
  const ascending = [...versions].sort((left, right) => left.idx - right.idx);
  const messages: ChatMessage[] = [];

  for (const version of ascending) {
    messages.push({
      id: `${version.id}-prompt`,
      role: "user",
      content: version.prompt.trim().length > 0 ? version.prompt : project.initial_prompt,
      createdAt: version.created_at,
      status: "complete",
    });
    messages.push({
      id: `${version.id}-reply`,
      role: "assistant",
      content:
        version.idx === 1
          ? `Built the ${PAGE_TYPE_LABELS[project.page_type].toLowerCase()}. Saved as v1.`
          : `Applied that change. Saved as v${version.idx}.`,
      createdAt: version.created_at,
      status: "complete",
    });
  }

  return messages;
}

/** Paths whose contents differ from the tree the run started with. */
function changedPaths(files: FileMap, baseFiles: FileMap | undefined): string[] {
  return Object.keys(files).filter((path) => baseFiles?.[path] !== files[path]);
}

function summarize({
  mode,
  name,
  summary,
  changed,
  saved,
}: {
  mode: GenerationMode;
  name: string;
  summary: string;
  changed: number;
  saved: boolean;
}): string {
  const files = `${changed} file${changed === 1 ? "" : "s"}`;
  const headline =
    mode === "refine"
      ? `Done — rewrote ${files}.`
      : `Built ${name.trim().length > 0 ? name.trim() : "your page"} — ${files}.`;

  const parts = [headline];
  if (mode === "create" && summary.trim().length > 0) parts.push(summary.trim());
  if (!saved) parts.push("Preview only: this run was not saved to version history.");

  return parts.join("\n");
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.length > 0) return payload.error;
  } catch {
    // Fall through to the status line.
  }
  return `The request failed with ${response.status}.`;
}
