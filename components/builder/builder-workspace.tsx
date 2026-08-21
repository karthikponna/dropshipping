"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { readStoredModel } from "@/components/dashboard/use-model-choice";
import { PreviewPanel } from "@/components/preview";
import type { GenerationStreamState } from "@/lib/ai/stream-client";
import { cx } from "@/lib/dashboard/format";
import { PAGE_TYPES, PAGE_TYPE_LABELS } from "@/lib/types";
import type {
  ChatMessage,
  FileMap,
  GenerationMode,
  ImageAsset,
  PageType,
  PreviewDevice,
  PreviewTab,
  ProjectPages,
  ProjectRecord,
  ProjectWithVersion,
  Theme,
  VersionSummary,
} from "@/lib/types";

import { ChatRail } from "./chat-rail";
import { ExportButton } from "./export-button";
import { ChatIcon, ScreenIcon } from "./icons";
import { peekActiveRun, useGeneration, type GenerationRequest } from "./use-generation";
import { VersionHistory } from "./version-history";

/**
 * The builder: conversation on the left, live preview on the right.
 *
 * A project is a shop, not a page, so everything here is held twice — once per
 * page type. Each page owns its tree, its theme, its history and its
 * conversation, and the switcher in the chat rail's header moves between them.
 * Keeping them apart matters because the two page types write to the same paths:
 * both frameworks emit `app/page.tsx` and `components/Navbar.tsx`, so a single
 * merged FileMap would have them overwriting each other.
 *
 * What ties the two together is the memory graph rather than this component.
 * Generating a product page in a project that already has a landing page sends
 * no theme from here at all; the server walks the graph, finds the landing
 * page's palette and type, and makes them a constraint in the prompt.
 *
 * The previewed route is a third piece of state, separate from both trees and
 * from the page being edited. It has to be: a shop is one site, so following a
 * cross-page link in the preview moves the viewport to the other route, and
 * doing that must not silently re-aim the composer at a page the user was only
 * looking at. Editing a page does pull the preview along, since that is what
 * anyone switching pages in the rail means.
 *
 * Persistence deliberately happens nowhere in this file. `POST /api/generate`
 * writes the `versions` row and moves the pointers as part of finishing a
 * generation — it already holds the files and has done the ownership check — and
 * reports the new id back on the `done` frame. The builder only reads history
 * and, for a restore, moves the pointer.
 */

export interface BuilderWorkspaceProps {
  project: ProjectRecord;
  /** Newest version of each page type, or null for a page never generated. */
  pages: ProjectPages;
  /** Every saved version, both page types; split per page below. */
  initialVersions: readonly VersionSummary[];
  /** `?autostart=1` from the dashboard dock: generate immediately, once. */
  autostart: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" } as const;

/** Everything the builder holds about one page of the shop. */
interface PageState {
  files: FileMap;
  theme: Theme | null;
  currentVersionId: string | null;
  messages: ChatMessage[];
}

type PagesState = Record<PageType, PageState>;

export function BuilderWorkspace({
  project,
  pages,
  initialVersions,
  autostart,
}: BuilderWorkspaceProps) {
  const router = useRouter();

  const [activePageType, setActivePageType] = useState<PageType>(project.page_type);
  /** Which route the preview renders — moved by links and the route switcher. */
  const [previewRoute, setPreviewRoute] = useState<PageType>(project.page_type);
  const [shopName, setShopName] = useState(project.name);
  const [versions, setVersions] = useState<readonly VersionSummary[]>(initialVersions);

  const [pageState, setPageState] = useState<PagesState>(() =>
    seedPages(project, pages, initialVersions),
  );

  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [tab, setTab] = useState<PreviewTab>("preview");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");

  const active = pageState[activePageType];
  const hasFiles = Object.keys(active.files).length > 0;

  const built = useMemo(
    () => PAGE_TYPES.filter((pageType) => Object.keys(pageState[pageType].files).length > 0),
    [pageState],
  );

  const appendMessage = useCallback((pageType: PageType, message: ChatMessage): void => {
    setPageState((current) => ({
      ...current,
      [pageType]: { ...current[pageType], messages: [...current[pageType].messages, message] },
    }));
  }, []);

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

  /**
   * Settles against the page the run was for, not the page on screen — the user
   * is free to switch pages mid-generation, and the result still belongs where
   * it started.
   */
  const onSettled = useCallback(
    (state: GenerationStreamState, request: GenerationRequest): void => {
      const pageType = request.pageType;

      if (state.error) {
        const { code, message, retryable } = state.error;

        appendMessage(
          pageType,
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
        );

        // A first generation that died halfway is still worth previewing; a
        // failed refinement must not replace a page that already works.
        setPageState((current) => {
          const page = current[pageType];
          if (Object.keys(page.files).length > 0 || Object.keys(state.files).length === 0) {
            return current;
          }
          return { ...current, [pageType]: { ...page, files: state.files, theme: state.theme } };
        });
        return;
      }

      const changed = changedPaths(state.files, request.baseFiles);

      setPageState((current) => ({
        ...current,
        [pageType]: {
          ...current[pageType],
          files: state.files,
          theme: state.theme,
          currentVersionId: state.versionId ?? current[pageType].currentVersionId,
          messages: [
            ...current[pageType].messages,
            {
              id: nextId("assistant"),
              role: "assistant",
              content: summarize({
                mode: request.mode,
                pageType,
                name: state.meta.name,
                summary: state.meta.summary,
                changed: changed.length,
                saved: state.versionId !== null,
                memory: state.memory.map((notice) => notice.message),
              }),
              createdAt: new Date().toISOString(),
              status: "complete",
            },
          ],
        },
      }));

      if (state.meta.name.trim().length > 0) setShopName(state.meta.name.trim());

      if (state.versionId) {
        void refreshVersions();
        // The dashboard's project list, counters and derived name read from the
        // server, so let them re-render with the row this run just wrote.
        router.refresh();
      }
    },
    [appendMessage, refreshVersions, router],
  );

  const generation = useGeneration({ projectId: project.id, onSettled });

  /** The page a run is building right now, or null when nothing is in flight. */
  const generatingPageType = generation.isStreaming
    ? (generation.lastRequest?.pageType ?? null)
    : null;
  const streamingHere = generatingPageType === activePageType;
  const streamingPreview = generatingPageType === previewRoute;

  const send = useCallback(
    (instruction: string, attachments: readonly ImageAsset[] = [], model?: string): void => {
      // The autostarted first run has no composer to name a model, so it falls
      // back to whatever the dock stored on its way here.
      const chosenModel = model ?? readStoredModel();
      const pageType = activePageType;
      const page = pageState[pageType];
      const pageHasFiles = Object.keys(page.files).length > 0;
      const mode: GenerationMode = pageHasFiles ? "refine" : "create";

      // Watch what is being written, whichever route was last being looked at.
      setPreviewRoute(pageType);

      appendMessage(pageType, {
        id: nextId("user"),
        role: "user",
        content: instruction,
        createdAt: new Date().toISOString(),
        status: "complete",
        ...(attachments.length > 0 ? { attachments } : {}),
      });

      generation.start({
        mode,
        pageType,
        prompt: instruction,
        ...(chosenModel ? { model: chosenModel } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        // A brand-new page sends no base theme on purpose: the server reads the
        // sibling page's design out of the graph, which also carries its section
        // structure and copy conventions. Passing a theme here would flatten
        // that to colours alone.
        ...(mode === "refine"
          ? { baseFiles: page.files, ...(page.theme ? { baseTheme: page.theme } : {}) }
          : {}),
      });
    },
    [activePageType, appendMessage, generation, pageState],
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

  const switchPage = useCallback((pageType: PageType): void => {
    setActivePageType(pageType);
    setPreviewRoute(pageType);
    setHistoryOpen(false);
    setTab("preview");
  }, []);

  /**
   * An empty route the user asked to fill, from the route switcher or the
   * preview's own empty state. Unlike changing the previewed route, this does
   * move the composer — a route with no page can only be looked at by building
   * it, so aiming the builder at it is the whole request.
   */
  const buildRoute = useCallback(
    (pageType: PageType): void => {
      switchPage(pageType);
      setMobilePane("chat");
    },
    [switchPage],
  );

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

        const pageType = version.page_type;
        setPageState((current) => ({
          ...current,
          [pageType]: {
            ...current[pageType],
            files: version.files,
            theme: version.theme,
            currentVersionId: version.id,
            messages: [
              ...current[pageType].messages,
              note(`Restored ${PAGE_TYPE_LABELS[pageType].toLowerCase()} v${version.idx}.`),
            ],
          },
        }));
        setActivePageType(pageType);
        setPreviewRoute(pageType);
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

  /** History is per page: the drawer shows the page you are looking at. */
  const pageVersions = useMemo(
    () => versions.filter((version) => version.page_type === activePageType),
    [activePageType, versions],
  );

  const previewed = pageState[previewRoute];
  const previewFiles =
    streamingPreview && generation.stream ? generation.stream.files : previewed.files;
  const previewTheme =
    streamingPreview && generation.stream ? generation.stream.theme : (previewed.theme ?? null);

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
            builtPageTypes={built}
            generatingPageType={generatingPageType}
            hasFiles={hasFiles}
            initialDraft={
              autostart || pages[activePageType] !== null || generation.isStreaming
                ? ""
                : project.initial_prompt
            }
            isStreaming={streamingHere}
            messages={active.messages}
            onCancel={generation.cancel}
            onOpenHistory={() => setHistoryOpen(true)}
            onPageTypeChange={switchPage}
            onRetry={retry}
            onSubmit={send}
            pageType={activePageType}
            projectId={project.id}
            projectName={shopName}
            siblingBuilt={built.includes(otherPage(activePageType))}
            stream={generation.stream}
            touched={streamingHere ? generation.touched : []}
            versionCount={pageVersions.length}
          />
        </div>

        <div className={cx("min-h-0 min-w-0", mobilePane === "preview" ? "" : "hidden md:block")}>
          <PreviewPanel
            actions={
              <ExportButton
                name={shopName}
                pages={{
                  landing: pageState.landing.files,
                  product: pageState.product.files,
                }}
                prompt={project.initial_prompt}
                theme={active.theme ?? pageState.landing.theme ?? pageState.product.theme}
              />
            }
            device={device}
            files={previewFiles}
            isStreaming={streamingPreview}
            onDeviceChange={setDevice}
            onTabChange={setTab}
            pageType={previewRoute}
            // Keyed per route so switching remounts the sandbox rather than
            // hot-swapping one page's tree into the other's running preview.
            previewKey={`${project.id}:${previewRoute}`}
            routes={{
              active: previewRoute,
              built,
              generating: generatingPageType,
              onBuild: buildRoute,
              onChange: setPreviewRoute,
            }}
            tab={tab}
            theme={previewTheme}
            title={shopName}
          />
        </div>
      </div>

      <VersionHistory
        currentVersionId={active.currentVersionId}
        error={historyError}
        onClose={() => setHistoryOpen(false)}
        onRestore={(versionId) => void restore(versionId)}
        open={historyOpen}
        pageType={activePageType}
        restoringId={restoringId}
        versions={pageVersions}
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

function otherPage(pageType: PageType): PageType {
  return pageType === "landing" ? "product" : "landing";
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

/** Builds the initial per-page state from what the server loaded. */
function seedPages(
  project: ProjectRecord,
  pages: ProjectPages,
  versions: readonly VersionSummary[],
): PagesState {
  const running = peekActiveRun(project.id);

  const build = (pageType: PageType): PageState => {
    const version = pages[pageType];
    const messages = seedMessages(
      versions.filter((row) => row.page_type === pageType),
      project,
      pageType,
    );

    // Returning to the page while a generation is still running: its prompt is
    // not in any saved version yet, so put the message back by hand.
    if (running && running.pageType === pageType) {
      messages.push({
        id: nextId("user"),
        role: "user",
        content: running.prompt,
        createdAt: new Date().toISOString(),
        status: "complete",
      });
    }

    return {
      files: version?.files ?? {},
      theme: version?.theme ?? null,
      currentVersionId: version?.id ?? null,
      messages,
    };
  };

  return { landing: build("landing"), product: build("product") };
}

/**
 * Rebuilds one page's conversation from its saved versions: each row stores the
 * prompt that produced it, so the rail survives a reload without a separate
 * messages table.
 */
function seedMessages(
  versions: readonly VersionSummary[],
  project: ProjectRecord,
  pageType: PageType,
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
          ? `Built the ${PAGE_TYPE_LABELS[pageType].toLowerCase()}. Saved as v1.`
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
  pageType,
  name,
  summary,
  changed,
  saved,
  memory,
}: {
  mode: GenerationMode;
  pageType: PageType;
  name: string;
  summary: string;
  changed: number;
  saved: boolean;
  memory: readonly string[];
}): string {
  const files = `${changed} file${changed === 1 ? "" : "s"}`;
  const headline =
    mode === "refine"
      ? `Done — rewrote ${files}.`
      : `Built the ${PAGE_TYPE_LABELS[pageType].toLowerCase()} for ${
          name.trim().length > 0 ? name.trim() : "your shop"
        } — ${files}.`;

  const parts = [headline];
  if (mode === "create" && summary.trim().length > 0) parts.push(summary.trim());
  for (const line of memory) parts.push(line);
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
