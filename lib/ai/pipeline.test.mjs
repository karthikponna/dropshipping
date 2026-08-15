import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * End-to-end test of the generation pipeline against a fake model. No network, no
 * Anthropic call, no database: `streamText` and `persist` are injected, so this
 * exercises the real prompts, the real parser and the real repair/refine/persist
 * branching offline.
 *
 * Run it with:
 *   node lib/ai/pipeline.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const { runGenerationPipeline } = await import("./pipeline.ts");
const { parseGenerateRequestBody, MAX_PROMPT_CHARS } = await import("./request.ts");
const { GenerationError, DEFAULT_THEME } = await import("@/lib/types");
const { LANDING_REQUIRED_FILES, PRODUCT_REQUIRED_FILES } = await import("@/lib/framework");

let checks = 0;
let failures = 0;

async function check(label, fn) {
  checks += 1;
  try {
    await fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    const detail = error.message.slice(0, 600).split("\n").join("\n       ");
    process.stdout.write(`  FAIL ${label}\n       ${detail}\n`);
  }
}

/* ─────────────────────────── fake model output ────────────────────────── */

const META = { name: "Ember & Oak", summary: "Hand-poured soy candles.", tagline: "Light one" };
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

function bodyFor(path) {
  const name = path.split("/").pop().replace(".tsx", "");
  const component = name === "page" ? "Page" : name;
  return `export default function ${component}() {\n  return <section className="bg-[#FFFFFF]">${component}</section>;\n}\n`;
}

function fileBlock(path) {
  return `<file path="${path}">\n${bodyFor(path)}</file>`;
}

function payloadFor(paths, { withMeta = true, withTheme = true } = {}) {
  return [
    ...(withMeta ? [`<meta>${JSON.stringify(META)}</meta>`] : []),
    ...(withTheme ? [`<theme>${JSON.stringify(THEME)}</theme>`] : []),
    ...paths.map(fileBlock),
    "",
  ].join("\n");
}

/**
 * A fake `streamText` that replays scripted payloads one per call, in 7-character
 * chunks, and records the prompts it was asked to run.
 */
function fakeModel(scripts) {
  const calls = [];
  let index = 0;

  const streamText = async ({ system, userMessage, maxTokens, onTextDelta }) => {
    const script = scripts[Math.min(index, scripts.length - 1)];
    index += 1;
    calls.push({ system, userMessage, maxTokens });

    const payload = script.payload ?? "";
    for (let i = 0; i < payload.length; i += 7) onTextDelta(payload.slice(i, i + 7));

    return { stopReason: script.stopReason ?? "end_turn" };
  };

  return { streamText, calls };
}

/** Runs the pipeline the way the route does: collect events, never throw. */
async function run(options) {
  const events = [];
  const write = (event) => events.push(event);
  try {
    await runGenerationPipeline({ ...options, write });
  } catch (error) {
    const failure = error instanceof GenerationError ? error : null;
    events.push(
      failure
        ? failure.toEvent()
        : { type: "error", code: "unknown", message: String(error?.message ?? error), retryable: true },
    );
  }
  return events;
}

const last = (events) => events[events.length - 1];
const phases = (events) => events.filter((event) => event.type === "status").map((event) => event.phase);

/* ───────────────────────────────── tests ──────────────────────────────── */

process.stdout.write("\ngeneration pipeline\n");

await check("landing: a complete stream produces every required file", async () => {
  const model = fakeModel([{ payload: payloadFor(LANDING_REQUIRED_FILES) }]);
  const events = await run({
    body: { pageType: "landing", prompt: "soy candle shop", mode: "create" },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.deepEqual(Object.keys(done.files).sort(), [...LANDING_REQUIRED_FILES].sort());
  assert.equal(done.theme.colors.primary, THEME.colors.primary);
  assert.equal(done.meta.name, META.name);
  assert.equal(done.versionId, undefined, "nothing to persist without a projectId");
  assert.equal(model.calls.length, 1, "no repair pass should have been needed");
  assert.deepEqual(phases(events), ["connecting", "planning", "writing", "saving", "complete"]);
});

await check("product: the same stream shape works for the other page type", async () => {
  const model = fakeModel([{ payload: payloadFor(PRODUCT_REQUIRED_FILES) }]);
  const events = await run({
    body: { pageType: "product", prompt: "cast iron skillet", mode: "create" },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.deepEqual(Object.keys(done.files).sort(), [...PRODUCT_REQUIRED_FILES].sort());
  assert.match(model.calls[0].system, /components\/AddToCart\.tsx/);
});

await check("a landing stream is rejected as incomplete for a product page", async () => {
  // The wrong page type cannot satisfy the required list, which is what makes the
  // constraint hard rather than advisory.
  const model = fakeModel([{ payload: payloadFor(LANDING_REQUIRED_FILES) }, { payload: "" }]);
  const events = await run({
    body: { pageType: "product", prompt: "cast iron skillet", mode: "create" },
    streamText: model.streamText,
  });

  const error = last(events);
  assert.equal(error.type, "error");
  assert.equal(error.code, "missing_files");
  assert.match(error.message, /components\/Gallery\.tsx/);
});

await check("missing files trigger exactly one targeted repair pass", async () => {
  const partial = LANDING_REQUIRED_FILES.filter(
    (path) => path !== "components/Pricing.tsx" && path !== "components/CTA.tsx",
  );
  const model = fakeModel([
    { payload: payloadFor(partial) },
    { payload: payloadFor(["components/Pricing.tsx", "components/CTA.tsx"], { withMeta: false, withTheme: false }) },
  ]);

  const events = await run({
    body: { pageType: "landing", prompt: "soy candle shop", mode: "create" },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.deepEqual(Object.keys(done.files).sort(), [...LANDING_REQUIRED_FILES].sort());
  assert.equal(model.calls.length, 2, "exactly one repair call");
  assert.ok(phases(events).includes("repairing"), "the repairing phase must be reported");

  const repairPrompt = model.calls[1].userMessage;
  assert.match(repairPrompt, /MISSING FILES/);
  assert.match(repairPrompt, /- components\/Pricing\.tsx/);
  assert.match(repairPrompt, /- components\/CTA\.tsx/);
  assert.equal(repairPrompt.includes("- components/Hero.tsx\n"), false, "repair must not re-request existing files");
  assert.ok(model.calls[1].maxTokens < model.calls[0].maxTokens, "repair uses a smaller budget");
});

await check("a repair that still comes back short fails with missing_files", async () => {
  const partial = LANDING_REQUIRED_FILES.filter((path) => path !== "components/Footer.tsx");
  const model = fakeModel([{ payload: payloadFor(partial) }, { payload: "I cannot do that." }]);

  const events = await run({
    body: { pageType: "landing", prompt: "soy candle shop", mode: "create" },
    streamText: model.streamText,
  });

  const error = last(events);
  assert.equal(error.type, "error");
  assert.equal(error.code, "missing_files");
  assert.equal(error.retryable, true);
  assert.equal(model.calls.length, 2, "never more than one repair attempt");
});

await check("a stream cut off at max_tokens reports truncated_stream", async () => {
  const full = payloadFor(LANDING_REQUIRED_FILES);
  const cut = full.slice(0, full.indexOf('<file path="components/Footer.tsx">') + 60);
  const model = fakeModel([
    { payload: cut, stopReason: "max_tokens" },
    { payload: "", stopReason: "max_tokens" },
  ]);

  const events = await run({
    body: { pageType: "landing", prompt: "soy candle shop", mode: "create" },
    streamText: model.streamText,
  });

  const error = last(events);
  assert.equal(error.type, "error");
  assert.equal(error.code, "truncated_stream");
  assert.match(error.message, /components\/Footer\.tsx/);
});

await check("a truncated file is recovered by the repair pass", async () => {
  const full = payloadFor(LANDING_REQUIRED_FILES);
  const cut = full.slice(0, full.indexOf('<file path="components/Footer.tsx">') + 60);
  const model = fakeModel([
    { payload: cut, stopReason: "max_tokens" },
    { payload: fileBlock("components/Footer.tsx") },
  ]);

  const events = await run({
    body: { pageType: "landing", prompt: "soy candle shop", mode: "create" },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(done.files["components/Footer.tsx"], bodyFor("components/Footer.tsx"));
});

await check("missing <meta>/<theme> fall back instead of failing", async () => {
  const model = fakeModel([
    { payload: payloadFor(LANDING_REQUIRED_FILES, { withMeta: false, withTheme: false }) },
  ]);
  const events = await run({
    body: { pageType: "landing", prompt: "Slow-burn soy candles for tiny flats.", mode: "create" },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(done.theme.colors.primary, DEFAULT_THEME.colors.primary);
  assert.equal(done.meta.name, "Slow-burn soy candles for");
  assert.ok(
    events.some((event) => event.type === "theme"),
    "a theme event must still reach the client",
  );
});

process.stdout.write("\nrefine mode\n");

await check("refine rewrites one file and leaves the rest byte-identical", async () => {
  const baseFiles = Object.fromEntries(LANDING_REQUIRED_FILES.map((path) => [path, bodyFor(path)]));
  const rewritten = `export default function Hero() {\n  return <section className="min-h-screen">Full screen</section>;\n}\n`;
  const model = fakeModel([{ payload: `<file path="components/Hero.tsx">\n${rewritten}</file>\n` }]);

  const events = await run({
    body: {
      pageType: "landing",
      prompt: "make the hero full-screen",
      mode: "refine",
      baseFiles,
      baseTheme: THEME,
    },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(model.calls.length, 1, "a well-formed refine needs no repair pass");
  assert.equal(done.files["components/Hero.tsx"], rewritten);
  for (const path of LANDING_REQUIRED_FILES) {
    if (path === "components/Hero.tsx") continue;
    assert.equal(done.files[path], baseFiles[path], `${path} must be untouched`);
  }
  assert.equal(done.theme.colors.primary, THEME.colors.primary, "the base theme carries over");
  assert.match(model.calls[0].system, /THIS TURN: REFINE/);
  assert.match(model.calls[0].userMessage, /make the hero full-screen/);
});

await check("refine that emits nothing still succeeds with the base tree", async () => {
  const baseFiles = Object.fromEntries(LANDING_REQUIRED_FILES.map((path) => [path, bodyFor(path)]));
  const model = fakeModel([{ payload: "Nothing needed changing." }]);

  const events = await run({
    body: { pageType: "landing", prompt: "looks good", mode: "refine", baseFiles, baseTheme: THEME },
    streamText: model.streamText,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.deepEqual(done.files, baseFiles);
});

process.stdout.write("\npersistence and failures\n");

await check("a successful save puts versionId and projectId in the done event", async () => {
  const model = fakeModel([{ payload: payloadFor(LANDING_REQUIRED_FILES) }]);
  const saved = [];

  const events = await run({
    body: { pageType: "landing", prompt: "soy candles", mode: "create", projectId: "project-1" },
    streamText: model.streamText,
    persist: async (input) => {
      saved.push(input);
      return { versionId: "version-9" };
    },
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(done.versionId, "version-9");
  assert.equal(done.projectId, "project-1");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].prompt, "soy candles");
  assert.deepEqual(Object.keys(saved[0].files).sort(), [...LANDING_REQUIRED_FILES].sort());
});

await check("an unconfigured database is skipped gracefully", async () => {
  const model = fakeModel([{ payload: payloadFor(LANDING_REQUIRED_FILES) }]);
  const events = await run({
    body: { pageType: "landing", prompt: "soy candles", mode: "create", projectId: "project-1" },
    streamText: model.streamText,
    persist: async () => null,
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(done.versionId, undefined);
  assert.equal(done.projectId, "project-1");
});

await check("a flaky database does not throw away a finished site", async () => {
  const model = fakeModel([{ payload: payloadFor(LANDING_REQUIRED_FILES) }]);
  const events = await run({
    body: { pageType: "landing", prompt: "soy candles", mode: "create", projectId: "project-1" },
    streamText: model.streamText,
    persist: async () => {
      throw new GenerationError("upstream_error", "connection reset");
    },
  });

  const done = last(events);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(done.versionId, undefined);
  assert.ok(
    events.some((event) => event.type === "status" && /Not saved to history/.test(event.message ?? "")),
    "the client must be told the save failed",
  );
});

await check("writing into someone else's project is a terminal error", async () => {
  const model = fakeModel([{ payload: payloadFor(LANDING_REQUIRED_FILES) }]);
  const events = await run({
    body: { pageType: "landing", prompt: "soy candles", mode: "create", projectId: "not-mine" },
    streamText: model.streamText,
    persist: async () => {
      throw new GenerationError("unauthorized", "That project does not belong to you.");
    },
  });

  const error = last(events);
  assert.equal(error.type, "error");
  assert.equal(error.code, "unauthorized");
  assert.equal(error.retryable, false);
});

await check("a model failure surfaces as a typed terminal error", async () => {
  const events = await run({
    body: { pageType: "landing", prompt: "soy candles", mode: "create" },
    streamText: async () => {
      throw new GenerationError("rate_limited", "429 from Anthropic.");
    },
  });

  const error = last(events);
  assert.equal(error.type, "error");
  assert.equal(error.code, "rate_limited");
  assert.equal(error.retryable, true);
});

await check("an aborted generation stops without a done event", async () => {
  const controller = new AbortController();
  const events = await run({
    body: { pageType: "landing", prompt: "soy candles", mode: "create" },
    signal: controller.signal,
    streamText: async ({ signal }) => {
      controller.abort();
      assert.equal(signal?.aborted, true, "the pipeline must forward the AbortSignal");
      throw new GenerationError("aborted", "Generation cancelled.");
    },
  });

  const error = last(events);
  assert.equal(error.type, "error");
  assert.equal(error.code, "aborted");
  assert.equal(error.retryable, false);
  assert.equal(
    events.some((event) => event.type === "done"),
    false,
  );
});

process.stdout.write("\nrequest validation\n");

function expectBadRequest(label, raw) {
  return check(label, async () => {
    assert.throws(
      () => parseGenerateRequestBody(raw),
      (error) => {
        assert.ok(error instanceof GenerationError, "must be a GenerationError");
        assert.equal(error.code, "bad_request");
        assert.equal(error.status, 400);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });
}

await check("a well-formed create body is normalised", async () => {
  const parsed = parseGenerateRequestBody({
    pageType: "landing",
    prompt: "  soy candle shop  ",
    baseTheme: { colors: { primary: "#123456" } },
  });
  assert.equal(parsed.prompt, "soy candle shop");
  assert.equal(parsed.mode, "create", "mode defaults to create");
  assert.equal(parsed.baseTheme.colors.primary, "#123456");
  assert.equal(parsed.baseTheme.fonts.heading.length > 0, true, "a partial theme is filled in");
  assert.equal("projectId" in parsed, false);
});

await check("a well-formed refine body keeps its base tree", async () => {
  const parsed = parseGenerateRequestBody({
    pageType: "product",
    prompt: "make the gallery taller",
    mode: "refine",
    projectId: " project-1 ",
    baseFiles: { "app/page.tsx": "page\n" },
  });
  assert.equal(parsed.mode, "refine");
  assert.equal(parsed.projectId, "project-1");
  assert.deepEqual(parsed.baseFiles, { "app/page.tsx": "page\n" });
});

await expectBadRequest("a non-object body", "just a string");
await expectBadRequest("an array body", []);
await expectBadRequest("an unknown page type", { pageType: "checkout", prompt: "x" });
await expectBadRequest("a missing prompt", { pageType: "landing" });
await expectBadRequest("a blank prompt", { pageType: "landing", prompt: "   " });
await expectBadRequest("an over-long prompt", {
  pageType: "landing",
  prompt: "x".repeat(MAX_PROMPT_CHARS + 1),
});
await expectBadRequest("an unknown mode", { pageType: "landing", prompt: "x", mode: "tweak" });
await expectBadRequest("refine without base files", { pageType: "landing", prompt: "x", mode: "refine" });
await expectBadRequest("refine with an empty base tree", {
  pageType: "landing",
  prompt: "x",
  mode: "refine",
  baseFiles: {},
});
await expectBadRequest("base files that are not strings", {
  pageType: "landing",
  prompt: "x",
  mode: "refine",
  baseFiles: { "app/page.tsx": 42 },
});
await expectBadRequest("an empty projectId", { pageType: "landing", prompt: "x", projectId: "  " });

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
