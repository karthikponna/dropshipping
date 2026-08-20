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
import type { ImageAsset } from "@/lib/types";

import {
  GENERATION_EFFORT,
  GENERATION_MAX_RETRIES,
  GENERATION_MODEL,
  GENERATION_TIMEOUT_MS,
  INVESTIGATION_EFFORT,
} from "./model";
import type { ToolSpec } from "./tools";

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
  /** Images the user attached, shown to the model alongside the text. */
  images?: readonly ImageAsset[];
  signal?: AbortSignal;
  /** Called with every assistant text delta, in order. */
  onTextDelta: (delta: string) => void;
}

export interface StreamTextResult {
  stopReason: GenerationStopReason | null;
  outputTokens: number;
}

/**
 * Builds the user turn's content.
 *
 * Images are referenced by URL rather than uploaded as base64: they already
 * live in a public bucket because the generated page has to be able to load
 * them, so sending the bytes a second time would only add a fetch, a buffer and
 * a third of a megabyte of JSON per photo.
 *
 * They go before the text, which is Anthropic's guidance — a model that has
 * already seen the pictures reads the instructions about them correctly.
 */
function buildUserContent(
  userMessage: string,
  images: readonly ImageAsset[] | undefined,
): string | Anthropic.ContentBlockParam[] {
  if (!images || images.length === 0) return userMessage;

  return [
    ...images.map(
      (image): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "url", url: image.url },
      }),
    ),
    { type: "text", text: userMessage },
  ];
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
  images,
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
        messages: [{ role: "user", content: buildUserContent(userMessage, images) }],
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

/* ───────────────────────────── tool loop ──────────────────────────────── */

export interface ToolLoopParams {
  client: Anthropic;
  model: string;
  system: string;
  userMessage: string;
  tools: readonly ToolSpec[];
  maxTokens: number;
  maxRounds: number;
  /** Runs one tool call and returns the JSON the model gets back. */
  dispatch: (call: { name: string; input: unknown }) => Promise<{ content: string; isError: boolean }>;
  /** Fires before each call, so the UI can say what is being looked at. */
  onToolCall?: (name: string, input: unknown) => void;
  signal?: AbortSignal;
}

export interface ToolLoopResult {
  /** The model's final prose, once it stopped calling tools. */
  text: string;
  toolCalls: number;
}

function toAnthropicTools(tools: readonly ToolSpec[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function textOf(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Runs a non-streaming conversation in which the model may call tools.
 *
 * Separate from `streamAssistantText` rather than a flag on it, because the two
 * cannot be the same call. A generation streams because its output *is* the
 * file protocol — the preview paints from the token stream. A turn that stops
 * to call a tool would break that protocol mid-file, so investigation happens
 * first, in full, and only then does the writing turn open its stream.
 *
 * The loop always ends with a text turn: if the model is still reaching for
 * tools when the round budget runs out, one final call with `tool_choice: none`
 * forces it to commit to what it already knows.
 */
export async function runToolLoop({
  client,
  model,
  system,
  userMessage,
  tools,
  maxTokens,
  maxRounds,
  dispatch,
  onToolCall,
  signal,
}: ToolLoopParams): Promise<ToolLoopResult> {
  const wireTools = toAnthropicTools(tools);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

  let toolCalls = 0;
  let text = "";

  try {
    for (let round = 0; round <= maxRounds; round += 1) {
      const exhausted = round === maxRounds;

      const response = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages,
          tools: wireTools,
          ...(INVESTIGATION_EFFORT === null
            ? {}
            : { output_config: { effort: INVESTIGATION_EFFORT } }),
          ...(exhausted ? { tool_choice: { type: "none" as const } } : {}),
        },
        { signal },
      );

      const said = textOf(response.content);
      if (said.length > 0) text = said;

      const uses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (uses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        onToolCall?.(use.name, use.input);
        const outcome = await dispatch({ name: use.name, input: use.input });
        toolCalls += 1;
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: outcome.content,
          is_error: outcome.isError,
        });
      }

      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    throw toGenerationError(error);
  }

  return { text, toolCalls };
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
    const detail = messageOf(error, "bad request");

    // Images are referenced by URL, so Anthropic has to be able to fetch them.
    // When it cannot, the raw message is about a "source" the user never saw —
    // name the actual cause instead, which is almost always a bucket that is
    // not public.
    if (/image/i.test(detail) && /(url|fetch|download|source)/i.test(detail)) {
      return new GenerationError(
        "upstream_error",
        "Anthropic could not load one of the attached photos. Check that the shop-assets bucket is public, then try again.",
        { retryable: false, status: 502, cause: error },
      );
    }

    return new GenerationError("upstream_error", `Anthropic rejected the request: ${detail}`, {
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
