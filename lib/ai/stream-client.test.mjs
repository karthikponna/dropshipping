import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test of the browser half of the streaming path — the code the builder
 * page actually runs. There is no Anthropic call and no dev server: `fetch` is
 * replaced with a fake that replays a recorded NDJSON transcript, deliberately
 * chunked across line and multi-byte boundaries, plus each of the failure shapes
 * the route can answer with.
 *
 * The point is the contract the builder depends on: the reconstructed FileMap is
 * byte-identical to what the "model" emitted, and every failure — including the
 * `missing_key` a user hits when they have not pasted a key yet — arrives as one
 * terminal error frame with a code and a retryable flag instead of a rejection.
 *
 * Run it with:
 *   node lib/ai/stream-client.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const {
  applyGenerationEvent,
  createGenerationStreamState,
  readGenerationEvents,
  runGenerationStream,
  streamGenerationEvents,
} = await import("./stream-client.ts");
const { encodeGenerationEvent, GENERATION_STREAM_CONTENT_TYPE } = await import("@/lib/types");

let checks = 0;
let failures = 0;

async function check(label, fn) {
  checks += 1;
  try {
    await fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL ${label}\n       ${String(error.message).slice(0, 400)}\n`);
  }
}

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const META = {
  name: "Ember & Oak",
  summary: "Hand-poured soy candles for slow evenings.",
  tagline: "Light one, slow down",
};

const THEME = {
  colors: {
    primary: "#1B4332",
    secondary: "#F4F1EA",
    accent: "#C8A24A",
    background: "#FFFFFF",
    foreground: "#14181C",
    muted: "#6B7280",
    border: "#E5E1D8",
  },
  fonts: { heading: "Fraunces", body: "Inter" },
  radius: "0.25rem",
};

/** Includes a non-ASCII character, so a chunk split inside it would corrupt it. */
const FILES = {
  "app/page.tsx": `import Hero from "@/components/Hero";

export default function Page() {
  return (
    <main className="bg-[#FFFFFF]">
      <Hero />
    </main>
  );
}
`,
  "components/Hero.tsx": `export default function Hero() {
  return (
    <section className="px-4 py-24">
      <h1 className="text-5xl">Ember & Oak — évenings, slowed down</h1>
    </section>
  );
}
`,
};

/** One complete, well-formed run, as the route would write it. */
function transcript({ versionId = "version-1", projectId = "project-1" } = {}) {
  const events = [
    { type: "status", phase: "connecting" },
    { type: "status", phase: "planning", message: "Designing your landing page…" },
    { type: "meta", meta: META },
    { type: "theme", theme: THEME },
    { type: "status", phase: "writing" },
  ];

  for (const [path, content] of Object.entries(FILES)) {
    events.push({ type: "file_start", path });
    // Three uneven slices per file, the way token boundaries actually fall.
    const cuts = [0, Math.floor(content.length / 3), Math.floor((content.length * 2) / 3), content.length];
    for (let index = 0; index < cuts.length - 1; index += 1) {
      events.push({ type: "file_delta", path, delta: content.slice(cuts[index], cuts[index + 1]) });
    }
    events.push({ type: "file_complete", path, content });
  }

  events.push({ type: "status", phase: "saving" });
  events.push({ type: "status", phase: "complete" });
  events.push({ type: "done", files: FILES, theme: THEME, meta: META, versionId, projectId });

  return events;
}

function ndjson(events) {
  return events.map((event) => encodeGenerationEvent(event)).join("");
}

/** A body that hands the reader `size`-byte slices, splitting lines and code points. */
function chunkedBody(text, size) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;

  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

function response(text, { status = 200, size = 17 } = {}) {
  return new Response(chunkedBody(text, size), {
    status,
    headers: { "Content-Type": GENERATION_STREAM_CONTENT_TYPE },
  });
}

/** Installs a fake `fetch` for one call and returns what the client sent. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

const realFetch = globalThis.fetch;

async function collect(options) {
  const events = [];
  for await (const event of streamGenerationEvents(options)) events.push(event);
  return events;
}

const CREATE_BODY = { pageType: "landing", prompt: "candle shop", mode: "create", projectId: "project-1" };

/* ──────────────────────────── framing ──────────────────────────── */

process.stdout.write("\nNDJSON framing\n");

await check("a transcript split every 1 byte still parses into the same events", async () => {
  const expected = transcript();
  const seen = [];
  for await (const event of readGenerationEvents(chunkedBody(ndjson(expected), 1))) seen.push(event);
  assert.deepEqual(seen, expected);
});

await check("blank lines and garbage between frames are skipped, not fatal", async () => {
  const text = `\n\nnot json\n${encodeGenerationEvent({ type: "status", phase: "writing" })}\n{"half":\n`;
  const seen = [];
  for await (const event of readGenerationEvents(chunkedBody(text, 5))) seen.push(event);
  assert.deepEqual(seen, [{ type: "status", phase: "writing" }]);
});

await check("a final frame with no trailing newline is still delivered", async () => {
  const text = JSON.stringify({ type: "status", phase: "complete" });
  const seen = [];
  for await (const event of readGenerationEvents(chunkedBody(text, 4))) seen.push(event);
  assert.deepEqual(seen, [{ type: "status", phase: "complete" }]);
});

/* ──────────────────────── a whole good run ──────────────────────── */

process.stdout.write("\na complete generation\n");

await check("the run is replayed frame for frame", async () => {
  const expected = transcript();
  stubFetch(() => response(ndjson(expected)));
  assert.deepEqual(await collect({ body: CREATE_BODY }), expected);
});

await check("the final state carries the tree byte-identically", async () => {
  stubFetch(() => response(ndjson(transcript())));
  const state = await runGenerationStream({ body: CREATE_BODY });

  assert.equal(state.error, null);
  assert.equal(state.done, true);
  assert.equal(state.phase, "complete");
  assert.deepEqual(state.files, FILES);
  assert.deepEqual(state.theme, THEME);
  assert.deepEqual(state.meta, META);
  assert.equal(state.versionId, "version-1");
  assert.equal(state.projectId, "project-1");
  assert.deepEqual(state.pending, []);
});

await check("deltas reconstruct each file exactly, before the done frame arrives", async () => {
  stubFetch(() => response(ndjson(transcript())));

  let state = createGenerationStreamState();
  for await (const event of streamGenerationEvents({ body: CREATE_BODY })) {
    if (event.type === "done") break;
    state = applyGenerationEvent(state, event);
  }

  assert.deepEqual(state.files, FILES, "the accumulated deltas must equal the finished files");
});

await check("pending tracks the file being written and empties as each closes", async () => {
  stubFetch(() => response(ndjson(transcript())));

  let state = createGenerationStreamState();
  let sawPending = false;
  for await (const event of streamGenerationEvents({ body: CREATE_BODY })) {
    state = applyGenerationEvent(state, event);
    if (event.type === "file_start") {
      sawPending = true;
      assert.ok(state.pending.includes(event.path), `${event.path} must be pending once opened`);
    }
    if (event.type === "file_complete") {
      assert.ok(!state.pending.includes(event.path), `${event.path} must clear on completion`);
    }
  }
  assert.ok(sawPending);
  assert.deepEqual(state.pending, []);
});

await check("the client posts NDJSON-accepting JSON to /api/generate", async () => {
  const calls = stubFetch(() => response(ndjson(transcript())));
  await runGenerationStream({ body: CREATE_BODY });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/generate");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Accept, GENERATION_STREAM_CONTENT_TYPE);
  assert.deepEqual(JSON.parse(calls[0].init.body), CREATE_BODY);
});

await check("refine mode starts from baseFiles, so untouched files stay identical", async () => {
  const baseFiles = { ...FILES, "components/Footer.tsx": "export default function Footer() {}\n" };
  const edited = `${FILES["components/Hero.tsx"]}\n// bigger\n`;

  stubFetch(() =>
    response(
      ndjson([
        { type: "status", phase: "writing" },
        { type: "file_start", path: "components/Hero.tsx" },
        { type: "file_complete", path: "components/Hero.tsx", content: edited },
        {
          type: "done",
          files: { ...baseFiles, "components/Hero.tsx": edited },
          theme: THEME,
          meta: META,
          versionId: "version-2",
        },
      ]),
    ),
  );

  const state = await runGenerationStream({
    body: { ...CREATE_BODY, mode: "refine", prompt: "make the hero bigger", baseFiles, baseTheme: THEME },
  });

  assert.equal(state.error, null);
  assert.equal(
    state.files["components/Footer.tsx"],
    baseFiles["components/Footer.tsx"],
    "a file the refinement did not touch must come back byte-identical",
  );
  assert.equal(state.files["components/Hero.tsx"], edited);
});

/* ───────────────────────────── failures ───────────────────────────── */

process.stdout.write("\nfailure shapes the builder has to render\n");

/** The route answers pre-stream failures with one NDJSON error line and an honest status. */
function errorResponse(code, message, retryable, status) {
  return response(encodeGenerationEvent({ type: "error", code, message, retryable }), { status });
}

await check("missing_key arrives as a terminal, non-retryable error rather than a throw", async () => {
  stubFetch(() =>
    errorResponse(
      "missing_key",
      "No Anthropic API key available. Add one in Settings, or set ANTHROPIC_API_KEY in .env.local.",
      false,
      400,
    ),
  );

  const state = await runGenerationStream({ body: CREATE_BODY });

  assert.ok(state.error, "the state must carry the error");
  assert.equal(state.error.code, "missing_key");
  assert.equal(state.error.retryable, false, "retrying without a key would fail identically");
  assert.equal(state.done, true, "the run is over");
  assert.match(state.error.message, /Settings/, "the message must point somewhere actionable");
  assert.deepEqual(state.files, {}, "nothing was generated");
});

for (const [code, retryable, status] of [
  ["invalid_key", false, 400],
  ["unauthorized", false, 401],
  ["bad_request", false, 400],
  ["rate_limited", true, 429],
  ["upstream_error", true, 500],
  ["missing_files", true, 500],
  ["truncated_stream", true, 500],
]) {
  await check(`${code} survives the wire with retryable=${retryable}`, async () => {
    stubFetch(() => errorResponse(code, `${code} happened`, retryable, status));
    const state = await runGenerationStream({ body: CREATE_BODY });
    assert.equal(state.error.code, code);
    assert.equal(state.error.retryable, retryable);
    assert.equal(state.done, true);
  });
}

await check("a stream that stops mid-generation is reported as truncated_stream", async () => {
  const partial = transcript().slice(0, 6);
  stubFetch(() => response(ndjson(partial)));

  const state = await runGenerationStream({ body: CREATE_BODY });
  assert.equal(state.error.code, "truncated_stream");
  assert.equal(state.error.retryable, true);
});

await check("a non-OK response with no error frame still settles as an error", async () => {
  stubFetch(() => new Response(null, { status: 502 }));
  const state = await runGenerationStream({ body: CREATE_BODY });
  assert.ok(state.error);
  assert.match(state.error.message, /502/);
});

await check("an unreachable endpoint becomes an unknown error, not a rejection", async () => {
  stubFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const state = await runGenerationStream({ body: CREATE_BODY });
  assert.equal(state.error.code, "unknown");
  assert.equal(state.error.retryable, true);
});

await check("cancelling reports aborted, which is not offered a retry", async () => {
  const controller = new AbortController();
  stubFetch(() => {
    controller.abort();
    throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
  });

  const state = await runGenerationStream({ body: CREATE_BODY, signal: controller.signal });
  assert.equal(state.error.code, "aborted");
  assert.equal(state.error.retryable, false);
});

await check("onEvent sees every frame, in order, exactly once", async () => {
  const expected = transcript();
  stubFetch(() => response(ndjson(expected)));

  const seen = [];
  await runGenerationStream({ body: CREATE_BODY, onEvent: (event) => seen.push(event.type) });
  assert.deepEqual(seen, expected.map((event) => event.type));
});

globalThis.fetch = realFetch;

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
