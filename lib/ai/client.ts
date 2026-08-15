import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import { GenerationError } from "@/lib/types";

import {
  GENERATION_EFFORT,
  GENERATION_MAX_RETRIES,
  GENERATION_MODEL,
  GENERATION_TIMEOUT_MS,
} from "./model";

/**
 * Thin wrapper over `@anthropic-ai/sdk`: one place that knows how to open a
 * streaming Messages call, and one place that turns every possible failure into
 * a typed `GenerationError` the route can emit as a terminal error event.
 *
 * Server-only — it is handed a decrypted API key.
 */

/** Why the model stopped: `"max_tokens"` means it was cut off mid-file. */
export type GenerationStopReason = Anthropic.StopReason;

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: GENERATION_MAX_RETRIES,
    timeout: GENERATION_TIMEOUT_MS,
  });
}

export interface StreamTextParams {
  client: Anthropic;
  system: string;
  userMessage: string;
  maxTokens: number;
  signal?: AbortSignal;
  /** Called with every assistant text delta, in order. */
  onTextDelta: (delta: string) => void;
}

export interface StreamTextResult {
  stopReason: GenerationStopReason | null;
  outputTokens: number;
}

/**
 * Streams one assistant turn, forwarding only text deltas. Thinking blocks are
 * ignored on purpose: the parser must never see them.
 */
export async function streamAssistantText({
  client,
  system,
  userMessage,
  maxTokens,
  signal,
  onTextDelta,
}: StreamTextParams): Promise<StreamTextResult> {
  let stopReason: GenerationStopReason | null = null;
  let outputTokens = 0;

  try {
    const stream = await client.messages.create(
      {
        model: GENERATION_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
        ...(GENERATION_EFFORT === null ? {} : { output_config: { effort: GENERATION_EFFORT } }),
        stream: true,
      },
      { signal },
    );

    for await (const event of stream) {
      if (signal?.aborted) {
        throw new GenerationError("aborted", "Generation cancelled.", { retryable: false });
      }

      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onTextDelta(event.delta.text);
        continue;
      }

      if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason;
        outputTokens = event.usage.output_tokens;
      }
    }
  } catch (error) {
    throw toGenerationError(error);
  }

  return { stopReason, outputTokens };
}

/* ──────────────────────────── error mapping ───────────────────────────── */

function isAbortLike(error: unknown): boolean {
  if (error instanceof APIUserAbortError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

/**
 * Maps anything thrown by the pipeline onto a `GenerationErrorCode`. Every exit
 * from the route goes through here, so a failure can never escape as an
 * unhandled 500.
 */
export function toGenerationError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error;

  if (isAbortLike(error)) {
    return new GenerationError("aborted", "Generation cancelled.", { retryable: false });
  }

  if (error instanceof AuthenticationError) {
    return new GenerationError(
      "invalid_key",
      "Anthropic rejected the API key (401). Check the key in Settings or ANTHROPIC_API_KEY.",
      { retryable: false, cause: error },
    );
  }

  if (error instanceof PermissionDeniedError) {
    return new GenerationError(
      "invalid_key",
      "This Anthropic API key is not allowed to use the Messages API (403).",
      { retryable: false, cause: error },
    );
  }

  if (error instanceof RateLimitError) {
    return new GenerationError(
      "rate_limited",
      "Anthropic rate limit reached (429). Wait a moment and try again.",
      { cause: error },
    );
  }

  if (error instanceof BadRequestError) {
    return new GenerationError("upstream_error", `Anthropic rejected the request: ${messageOf(error, "bad request")}`, {
      retryable: false,
      status: 502,
      cause: error,
    });
  }

  if (error instanceof APIConnectionError) {
    return new GenerationError(
      "upstream_error",
      "Could not reach Anthropic. Check the network connection and try again.",
      { status: 502, cause: error },
    );
  }

  if (error instanceof APIError) {
    const status = typeof error.status === "number" ? error.status : 500;
    if (status === 429 || status === 529) {
      return new GenerationError("rate_limited", "Anthropic is overloaded right now. Try again shortly.", {
        cause: error,
      });
    }
    return new GenerationError(
      "upstream_error",
      `Anthropic returned ${status}: ${messageOf(error, "upstream failure")}`,
      { status: 502, cause: error },
    );
  }

  return new GenerationError("unknown", messageOf(error, "Generation failed for an unknown reason."), {
    cause: error,
  });
}
