"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowUpIcon } from "@/components/dashboard/icons";
import type { GenerationStreamState } from "@/lib/ai/stream-client";
import { cx, formatCount } from "@/lib/dashboard/format";
import { PAGE_TYPE_LABELS, type ChatMessage, type ImageAsset, type PageType } from "@/lib/types";

import { AttachButton, AttachmentStrip } from "./attachment-strip";
import { ChatMessageView } from "./chat-message-view";
import { HistoryIcon } from "./icons";
import { PageTypeSwitcher } from "./page-type-switcher";
import { StreamActivity } from "./stream-activity";
import { useAttachments } from "./use-attachments";

/**
 * The conversation half of the builder: what has been asked and built so far,
 * the live run, and the box that asks for the next change.
 *
 * The history is reconstructed from the project's saved versions on every load
 * (each version stores the prompt that produced it), so a refresh mid-project
 * shows the same conversation rather than an empty rail.
 */

const MAX_INSTRUCTION_CHARS = 4_000;

/** Stands in for the words a user did not write when they only sent photos. */
function defaultPhotoInstruction(count: number): string {
  return count === 1
    ? "Use the attached photo on this page — put it in the most prominent image frame and match the design to it."
    : `Use the ${count} attached photos on this page — put them in the main image frames and match the design to them.`;
}

function hasImageFiles(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

/** The image files in a drop or a paste; empty for text-only payloads. */
function imageFilesFrom(transfer: DataTransfer | null): File[] {
  return Array.from(transfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
}

/** Concrete refinements per page, so the composer is never a blank box. */
const REFINEMENT_EXAMPLES: Record<PageType, readonly string[]> = {
  landing: ["Make the hero bigger", "Warmer palette", "Add a FAQ section"],
  product: ["Add a size guide to the specs", "Show a bundle discount", "More lifestyle photos"],
};

export interface ChatRailProps {
  /** Scopes uploaded photos to this shop inside the storage bucket. */
  projectId: string;
  projectName: string;
  pageType: PageType;
  /** Page types with at least one generated version, for the switcher's dots. */
  builtPageTypes: readonly PageType[];
  /** The page a run is generating right now, which may not be the active one. */
  generatingPageType: PageType | null;
  /** True when the *other* page exists, so a new page can inherit its design. */
  siblingBuilt: boolean;
  messages: readonly ChatMessage[];
  /** Live state of the current run, or the most recent one. */
  stream: GenerationStreamState | null;
  touched: readonly string[];
  isStreaming: boolean;
  /** False until the first generation lands, which switches the composer to refine. */
  hasFiles: boolean;
  versionCount: number;
  /**
   * Text the composer starts with — the project's own prompt when nothing has
   * been generated and nothing is about to be, so the first run is one keypress
   * away. Empty otherwise.
   */
  initialDraft: string;
  onSubmit: (instruction: string, attachments: readonly ImageAsset[]) => void;
  onPageTypeChange: (pageType: PageType) => void;
  onRetry: () => void;
  onCancel: () => void;
  onOpenHistory: () => void;
}

export function ChatRail({
  projectId,
  projectName,
  pageType,
  builtPageTypes,
  generatingPageType,
  siblingBuilt,
  messages,
  stream,
  touched,
  isStreaming,
  hasFiles,
  versionCount,
  initialDraft,
  onSubmit,
  onPageTypeChange,
  onRetry,
  onCancel,
  onOpenHistory,
}: ChatRailProps) {
  const [instruction, setInstruction] = useState(initialDraft);
  const [dropping, setDropping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachments = useAttachments(projectId);

  const typed = instruction.trim();
  // A photo on its own is a complete request once the page exists — "put this
  // in" is obvious from the attachment — but the first build still needs words.
  const photosAlone = attachments.items.length > 0 && hasFiles;
  const canSubmit = (typed.length > 0 || photosAlone) && !isStreaming && !attachments.busy;

  // Follow the conversation as it grows, and while a run streams.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length, isStreaming, stream?.phase, touched.length]);

  // The composer is per page, so switching pages must not carry a half-typed
  // instruction, or photos meant for the other page, across.
  useEffect(() => {
    setInstruction("");
    attachments.clear();
    // `attachments.clear` is stable; re-running on the object identity would
    // wipe the tray on every upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageType]);

  const submit = (): void => {
    if (!canSubmit) return;
    const text =
      typed.length > 0
        ? typed.slice(0, MAX_INSTRUCTION_CHARS)
        : defaultPhotoInstruction(attachments.items.length);

    onSubmit(text, attachments.items);
    setInstruction("");
    attachments.clear();
  };

  return (
    <section
      aria-label="Conversation"
      // Deliberately not overflow-hidden: the page switcher's menu drops out of
      // the header and would be clipped by it. Each child clips itself instead —
      // the message list scrolls inside its own box.
      className="flex h-full min-h-0 flex-col rounded-amb-panel border border-amb-border bg-amb-background shadow-amb-xs"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-amb-border px-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] leading-tight font-semibold tracking-[-0.015em]">
            {projectName}
          </h2>
        </div>
        <PageTypeSwitcher
          active={pageType}
          built={builtPageTypes}
          generating={generatingPageType}
          onChange={onPageTypeChange}
        />
        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex h-7 items-center gap-1.5 rounded-amb-row border border-amb-border px-2 text-[12px] font-medium text-amb-muted-foreground transition-colors hover:bg-amb-secondary hover:text-amb-foreground"
        >
          <HistoryIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">History</span>
          {versionCount > 0 ? (
            <span className="font-amb-mono text-[11px]">{versionCount}</span>
          ) : null}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" ref={scrollRef}>
        {messages.map((message) => (
          <ChatMessageView
            busy={isStreaming}
            key={message.id}
            message={message}
            onRetry={onRetry}
          />
        ))}

        {isStreaming && stream ? (
          <StreamActivity onCancel={onCancel} stream={stream} touched={touched} />
        ) : null}

        {!hasFiles && !isStreaming && messages.length === 0 ? (
          <p className="rounded-amb-panel border border-dashed border-amb-border p-3 text-[12px] leading-[1.55] text-amb-muted-foreground">
            {siblingBuilt ? (
              <>
                This shop has no {PAGE_TYPE_LABELS[pageType].toLowerCase()} yet. Describe the
                product you want to sell and it will be built in the same palette, type and voice
                as the rest of the shop — you only need to say what changes.
              </>
            ) : (
              <>
                Nothing has been generated for this page yet. The description below is the one you
                created it with — send it to build the first version.
              </>
            )}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-amb-border p-3">
        {hasFiles && !isStreaming ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REFINEMENT_EXAMPLES[pageType].map((example) => (
              <button
                className="rounded-full border border-amb-border px-2.5 py-1 text-[12px] text-amb-muted-foreground transition-colors hover:bg-amb-secondary hover:text-amb-foreground"
                key={example}
                onClick={() => setInstruction(example)}
                type="button"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {/* Dropping a photo anywhere on the composer attaches it, which is what
            a user who has just dragged one out of Finder expects. */}
        <div
          className={cx(
            "rounded-amb-panel border bg-amb-background px-2.5 py-2 transition-colors focus-within:border-amb-foreground/25",
            dropping ? "border-amb-foreground/40 bg-amb-secondary" : "border-amb-input",
          )}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDropping(false);
          }}
          onDragOver={(event) => {
            if (isStreaming || !hasImageFiles(event.dataTransfer)) return;
            event.preventDefault();
            setDropping(true);
          }}
          onDrop={(event) => {
            if (isStreaming) return;
            const images = imageFilesFrom(event.dataTransfer);
            if (images.length === 0) return;
            event.preventDefault();
            setDropping(false);
            attachments.add(images);
          }}
        >
          <AttachmentStrip
            items={attachments.items}
            onRemove={attachments.remove}
            pending={attachments.pending}
          />

          <div className="flex items-start gap-1">
            <textarea
              aria-label={hasFiles ? "Describe a change" : "Describe your shop"}
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent text-[14px] leading-[1.5] text-amb-foreground placeholder:text-amb-muted-foreground focus:outline-none"
              disabled={isStreaming}
              maxLength={MAX_INSTRUCTION_CHARS}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              // Screenshots and copied photos paste straight in.
              onPaste={(event) => {
                const images = imageFilesFrom(event.clipboardData);
                if (images.length === 0) return;
                event.preventDefault();
                attachments.add(images);
              }}
              placeholder={
                hasFiles
                  ? "Make the hero bigger, change to a blue theme…"
                  : siblingBuilt
                    ? "Describe the product — what it is, who buys it, what makes it worth the price."
                    : "Describe your shop — what you sell, who it's for, the mood you want."
              }
              rows={2}
              value={instruction}
            />

            <AttachButton
              disabled={isStreaming}
              full={attachments.full}
              onPick={attachments.add}
            />

            <button
              aria-label={hasFiles ? "Send this change" : "Build this page"}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amb-primary text-amb-primary-foreground transition-colors disabled:bg-amb-accent disabled:text-amb-muted-foreground"
              disabled={!canSubmit}
              onClick={submit}
              type="button"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-[11px] text-amb-muted-foreground/80">
          {attachments.error ? (
            <span className="text-amb-destructive">{attachments.error}</span>
          ) : isStreaming ? (
            "Generating — the preview updates as files arrive."
          ) : attachments.busy ? (
            "Uploading your photos…"
          ) : attachments.items.length > 0 ? (
            // Photos alone are enough to refine an existing page, but the first
            // build still needs a sentence — say so rather than leaving the send
            // button mysteriously dead.
            photosAlone || typed.length > 0 ? (
              `${formatCount(attachments.items.length, "photo")} attached — they go into the page itself, not just the description.`
            ) : (
              "Now describe the shop these photos are for, and send."
            )
          ) : generatingPageType ? (
            `Still building the ${PAGE_TYPE_LABELS[generatingPageType].toLowerCase()} in the background.`
          ) : hasFiles ? (
            `Enter to send. Every change saves a new version — ${formatCount(versionCount, "version")} so far.`
          ) : siblingBuilt ? (
            "Enter to build. This page will reuse the shop's existing design."
          ) : (
            "Enter to build, or attach photos of what you sell."
          )}
        </p>
      </div>
    </section>
  );
}
