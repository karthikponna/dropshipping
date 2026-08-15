"use client";

import { useActionState, useRef, useState } from "react";

import { createProjectFromPromptAction } from "@/lib/dashboard/actions";
import { cx } from "@/lib/dashboard/format";
import { PROJECT_FORM_INITIAL_STATE } from "@/lib/dashboard/form-state";
import { PAGE_TYPE_LABELS, PAGE_TYPES, type PageType } from "@/lib/types";
import { ArrowUpIcon, LayoutIcon, TagIcon } from "./icons";

const PAGE_TYPE_ICONS: Record<PageType, (props: { className?: string }) => React.ReactElement> = {
  landing: LayoutIcon,
  product: TagIcon,
};

interface AiDockProps {
  /** One line per page type describing what gets generated. */
  hints: Record<PageType, string>;
  defaultPageType?: PageType;
}

/**
 * The product's front door: pick a page type, describe the shop, submit. The
 * action creates the project row and forwards to the builder with
 * `?autostart=1`, which is what kicks off the first generation.
 */
export function AiDock({ hints, defaultPageType = "landing" }: AiDockProps) {
  const [state, formAction, pending] = useActionState(
    createProjectFromPromptAction,
    PROJECT_FORM_INITIAL_STATE,
  );
  const [pageType, setPageType] = useState<PageType>(defaultPageType);
  const [prompt, setPrompt] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const canSubmit = prompt.trim().length > 0 && !pending;

  return (
    <div className="flex w-full flex-col items-center">
      <form
        ref={formRef}
        action={formAction}
        className="w-amb-dock max-w-full overflow-hidden rounded-amb-dock border border-transparent bg-amb-card shadow-amb-float"
      >
        <input type="hidden" name="pageType" value={pageType} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-3 sm:px-4">
          <div
            role="radiogroup"
            aria-label="Page type"
            className="inline-flex items-center gap-1 rounded-full bg-amb-secondary p-1"
          >
            {PAGE_TYPES.map((type) => {
              const Icon = PAGE_TYPE_ICONS[type];
              const selected = type === pageType;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPageType(type)}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium tracking-[-0.01em] transition-colors",
                    selected
                      ? "bg-amb-primary text-amb-primary-foreground shadow-amb-control"
                      : "text-amb-muted-foreground hover:text-amb-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {PAGE_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>

          <p className="hidden min-w-0 flex-1 truncate text-[12px] text-amb-muted-foreground md:block">
            {hints[pageType]}
          </p>
        </div>

        <div className="px-4 pt-2 pb-3">
          <div className="flex items-start gap-2">
            <textarea
              name="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (canSubmit) formRef.current?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="Describe your shop — what you sell, who it's for, the mood you want."
              aria-label="Describe your shop"
              className="max-h-40 min-h-14 flex-1 resize-none bg-transparent text-[16px] leading-6 text-amb-foreground placeholder:text-amb-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label={pending ? "Creating your page" : "Build this page"}
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amb-primary text-amb-primary-foreground transition-colors disabled:bg-amb-accent disabled:text-amb-muted-foreground"
            >
              {pending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <ArrowUpIcon />
              )}
            </button>
          </div>

          <p className="mt-1 text-[12px] text-amb-muted-foreground/70">
            {pending
              ? "Creating the page…"
              : "Enter to build. Shift + Enter for a new line."}
          </p>
        </div>
      </form>

      {state.error && (
        <p
          role="alert"
          className="mt-3 max-w-[674px] text-center text-[13px] text-amb-destructive"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
