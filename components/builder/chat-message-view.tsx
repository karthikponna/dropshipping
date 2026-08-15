"use client";

import Link from "next/link";

import { SparkleIcon } from "@/components/dashboard/icons";
import type { ChatMessage, GenerationErrorCode } from "@/lib/types";

import { AlertIcon } from "./icons";

/**
 * One turn in the builder conversation. Errors are turns too: the engine emits a
 * `GenerationErrorCode` plus a `retryable` flag with every failure, and both are
 * carried on the message, so what the user sees — the sentence, whether there is
 * a Retry button, and where they are sent to fix it — is decided entirely by the
 * code rather than by string-matching a message.
 */

interface ErrorGuidance {
  /** What the user should do about it, in one clause. */
  hint: string;
  action?: { href: string; label: string };
}

const ERROR_GUIDANCE: Record<GenerationErrorCode, ErrorGuidance> = {
  missing_key: {
    hint: "Generation needs an Anthropic API key. Add yours and it is stored encrypted against your account.",
    action: { href: "/dashboard/settings", label: "Add a key in Settings" },
  },
  invalid_key: {
    hint: "Anthropic rejected the key. Check it was copied whole and is still active.",
    action: { href: "/dashboard/settings", label: "Update the key" },
  },
  rate_limited: {
    hint: "Anthropic is rate-limiting this key. Wait a few seconds and try again.",
  },
  upstream_error: {
    hint: "Anthropic failed mid-request. Retrying usually clears it.",
  },
  truncated_stream: {
    hint: "The reply was cut off before the last file closed. Retry, or shorten the description.",
  },
  missing_files: {
    hint: "Some required components never arrived. Retry to fill the gaps.",
  },
  unauthorized: {
    hint: "Your session expired.",
    action: { href: "/login", label: "Sign in again" },
  },
  bad_request: {
    hint: "The builder sent something the generator would not accept. Reload the page and try again.",
  },
  aborted: {
    hint: "Cancelled — nothing was saved.",
  },
  unknown: {
    hint: "Something unexpected went wrong. Retrying is safe.",
  },
};

export interface ChatMessageViewProps {
  message: ChatMessage;
  /** Rendered as a Retry button when the message is a retryable failure. */
  onRetry?: () => void;
  /** Suppresses Retry while another generation is already running. */
  busy?: boolean;
}

export function ChatMessageView({ message, onRetry, busy = false }: ChatMessageViewProps) {
  if (message.status === "error") {
    const guidance = ERROR_GUIDANCE[message.errorCode ?? "unknown"];

    return (
      <div
        className="rounded-amb-panel border border-amb-destructive/20 bg-amb-destructive/[0.04] p-3"
        role="alert"
      >
        <p className="flex items-start gap-2 text-[13px] font-medium text-amb-destructive">
          <AlertIcon className="mt-px h-4 w-4" />
          <span className="min-w-0">{message.content}</span>
        </p>
        <p className="mt-1.5 pl-6 text-[12px] leading-[1.5] text-amb-muted-foreground">
          {guidance.hint}
        </p>
        {(message.retryable && onRetry) || guidance.action ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
            {message.retryable && onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="inline-flex h-7 items-center rounded-amb-row bg-amb-primary px-2.5 text-[12px] font-medium text-amb-primary-foreground transition-colors hover:bg-amb-foreground/90 disabled:bg-amb-accent disabled:text-amb-muted-foreground"
              >
                Try again
              </button>
            ) : null}
            {guidance.action ? (
              <Link
                href={guidance.action.href}
                className="inline-flex h-7 items-center rounded-amb-row border border-amb-border px-2.5 text-[12px] font-medium text-amb-foreground transition-colors hover:bg-amb-secondary"
              >
                {guidance.action.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <p className="px-1 text-center text-[12px] text-amb-muted-foreground">{message.content}</p>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-amb-panel bg-amb-secondary px-3 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap text-amb-foreground">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amb-border bg-amb-muted text-amb-muted-foreground"
      >
        <SparkleIcon className="h-3.5 w-3.5" />
      </span>
      <p className="min-w-0 pt-0.5 text-[13px] leading-[1.5] whitespace-pre-wrap text-amb-foreground">
        {message.content}
      </p>
    </div>
  );
}
