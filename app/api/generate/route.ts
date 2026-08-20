import { resolveAnthropicKey } from "@/lib/anthropic-key";
import { createAnthropicClient, runToolLoop, streamAssistantText, toGenerationError } from "@/lib/ai/client";
import { createInvestigator } from "@/lib/ai/investigate";
import { recallGenerationMemory, rememberGeneration } from "@/lib/ai/memory";
import { INVESTIGATION_MODEL } from "@/lib/ai/model";
import { resolvePastWork } from "@/lib/ai/past-project";
import { persistGeneratedVersion } from "@/lib/ai/persistence";
import { runGenerationPipeline } from "@/lib/ai/pipeline";
import { parseGenerateRequestBody } from "@/lib/ai/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GENERATION_STREAM_CONTENT_TYPE, GenerationError, encodeGenerationEvent } from "@/lib/types";
import type { GenerateRequestBody, GenerationEvent } from "@/lib/types";

/**
 * POST /api/generate — streams a whole generated site as NDJSON `GenerationEvent`
 * lines (one JSON object per line, `application/x-ndjson`).
 *
 * A run looks like:
 *   status(connecting) → status(planning) → meta → theme → status(writing)
 *   → file_start / file_delta… / file_complete per file
 *   → [status(repairing) and one targeted pass for missing files]
 *   → status(saving) → status(complete) → done
 *
 * Every failure, before or during the stream, arrives as one terminal `error`
 * event carrying a `GenerationErrorCode`. Nothing escapes as an unhandled 500.
 *
 * This file owns transport, validation, auth and wiring. The generation sequence
 * itself is lib/ai/pipeline.ts; consume the stream with lib/ai/stream-client.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function streamHeaders(): HeadersInit {
  return {
    "Content-Type": GENERATION_STREAM_CONTENT_TYPE,
    "Cache-Control": "no-cache, no-store, no-transform",
    // Tells proxies and Vercel's edge to pass chunks straight through.
    "X-Accel-Buffering": "no",
  };
}

/**
 * Failures that happen before the stream opens still answer in the stream's own
 * format — one NDJSON error line — so the client only needs one code path, while
 * the HTTP status stays honest.
 */
function errorResponse(error: GenerationError): Response {
  return new Response(encodeGenerationEvent(error.toEvent()), {
    status: error.status,
    headers: streamHeaders(),
  });
}

/**
 * Requires a session whenever Supabase is configured. With it unconfigured the
 * endpoint stays open, so the generator can be driven locally without a database.
 */
async function assertAuthorized(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new GenerationError("unauthorized", "Sign in to generate a site.", { retryable: false });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: GenerateRequestBody;
  let apiKey: string;

  try {
    const raw: unknown = await request.json().catch(() => {
      throw new GenerationError("bad_request", "Request body must be valid JSON.", { retryable: false });
    });
    body = parseGenerateRequestBody(raw);
    await assertAuthorized();
    apiKey = (await resolveAnthropicKey()).key;
  } catch (error) {
    return errorResponse(toGenerationError(error));
  }

  const abort = new AbortController();
  const onClientAbort = (): void => abort.abort();
  request.signal.addEventListener("abort", onClientAbort);

  const client = createAnthropicClient(apiKey);
  const encoder = new TextEncoder();
  // One model for the whole run: the investigation reads the files the writing
  // turn then edits, and splitting them would have one model plan for another.
  const model = body.model ?? INVESTIGATION_MODEL;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (event: GenerationEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeGenerationEvent(event)));
        } catch {
          // The client hung up mid-flight; stop talking to it.
          closed = true;
        }
      };

      try {
        await runGenerationPipeline({
          body,
          write,
          signal: abort.signal,
          streamText: (params) => streamAssistantText({ client, model, ...params }),
          persist: persistGeneratedVersion,
          recall: recallGenerationMemory,
          investigate: createInvestigator(
            (params) => runToolLoop({ client, model, ...params }),
            resolvePastWork,
          ),
          remember: rememberGeneration(body),
        });
      } catch (error) {
        write(toGenerationError(error).toEvent());
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      }
    },
    cancel() {
      // Client disconnected or cancelled the reader: stop billing tokens.
      abort.abort();
    },
  });

  return new Response(stream, { status: 200, headers: streamHeaders() });
}
