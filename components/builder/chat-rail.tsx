"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowUpIcon } from "@/components/dashboard/icons";
import { PageTypeBadge } from "@/components/dashboard/page-type-badge";
import type { GenerationStreamState } from "@/lib/ai/stream-client";
import { formatCount } from "@/lib/dashboard/format";
import type { ChatMessage, PageType } from "@/lib/types";

import { ChatMessageView } from "./chat-message-view";
import { HistoryIcon } from "./icons";
import { StreamActivity } from "./stream-activity";

/**
 * The conversation half of the builder: what has been asked and built so far,
 * the live run, and the box that asks for the next change.
 *
 * The history is reconstructed from the project's saved versions on every load
 * (each version stores the prompt that produced it), so a refresh mid-project
 * shows the same conversation rather than an empty rail.
 */

const MAX_INSTRUCTION_CHARS = 4_000;

/** Concrete refinements, so the empty rail is not a blank box. */
const REFINEMENT_EXAMPLES = [
  "Make the hero bigger",
  "Change to a blue theme",
  "Add a size guide to the specs",
] as const;

export interface ChatRailProps {
  projectName: string;
  pageType: PageType;
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
  onSubmit: (instruction: string) => void;
  onRetry: () => void;
  onCancel: () => void;
  onOpenHistory: () => void;
}

export function ChatRail({
  projectName,
  pageType,
  messages,
  stream,
  touched,
  isStreaming,
  hasFiles,
  versionCount,
  initialDraft,
  onSubmit,
  onRetry,
  onCancel,
  onOpenHistory,
}: ChatRailProps) {
  const [instruction, setInstruction] = useState(initialDraft);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canSubmit = instruction.trim().length > 0 && !isStreaming;

  // Follow the conversation as it grows, and while a run streams.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length, isStreaming, stream?.phase, touched.length]);

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit(instruction.trim().slice(0, MAX_INSTRUCTION_CHARS));
    setInstruction("");
  };

  return (
    <section
      aria-label="Conversation"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-amb-panel border border-amb-border bg-amb-background shadow-amb-xs"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-amb-border px-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] leading-tight font-semibold tracking-[-0.015em]">
            {projectName}
          </h2>
        </div>
        <PageTypeBadge pageType={pageType} />
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
            Nothing has been generated for this page yet. The description below is the one you
            created it with — send it to build the first version.
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-amb-border p-3">
        {hasFiles && !isStreaming ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REFINEMENT_EXAMPLES.map((example) => (
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

        <div className="flex items-start gap-2 rounded-amb-panel border border-amb-input bg-amb-background px-2.5 py-2 focus-within:border-amb-foreground/25">
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
            placeholder={
              hasFiles
                ? "Make the hero bigger, change to a blue theme…"
                : "Describe your shop — what you sell, who it's for, the mood you want."
            }
            rows={2}
            value={instruction}
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

        <p className="mt-1.5 text-[11px] text-amb-muted-foreground/80">
          {isStreaming
            ? "Generating — the preview updates as files arrive."
            : hasFiles
              ? `Enter to send. Every change saves a new version — ${formatCount(versionCount, "version")} so far.`
              : "Enter to build. Shift + Enter for a new line."}
        </p>
      </div>
    </section>
  );
}
