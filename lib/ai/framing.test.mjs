import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test for the NDJSON framing and the prompt builders. No network and no
 * Anthropic call: it encodes `GenerationEvent`s the way the route does, replays
 * the bytes through the client helper at hostile boundaries, and checks that the
 * two page types really do produce different prompts.
 *
 * Run it with:
 *   node lib/ai/framing.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const { encodeGenerationEvent, parseGenerationEvent, DEFAULT_THEME, DEFAULT_META } = await import("@/lib/types");
const { readGenerationEvents, applyGenerationEvent, createGenerationStreamState } = await import(
  "./stream-client.ts"
);
const { buildSystemPrompt, buildCreateMessage, buildRefineMessage, buildRepairMessage } = await import(
  "./prompts/index.ts"
);
const { parseAttachments } = await import("./request.ts");

let checks = 0;
let failures = 0;

/** Prompt assertions compare against multi-KB strings; keep the report readable. */
function report(label, error) {
  failures += 1;
  const detail = error.message.slice(0, 600).split("\n").join("\n       ");
  process.stdout.write(`  FAIL ${label}\n       ${detail}\n`);
}

function check(label, fn) {
  checks += 1;
  try {
    fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    report(label, error);
  }
}

async function checkAsync(label, fn) {
  checks += 1;
  try {
    await fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    report(label, error);
  }
}

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const HERO = `export default function Hero() {\n  return <section>“Ембер” — slow evenings 🕯️</section>;\n}\n`;

const EVENTS = [
  { type: "status", phase: "connecting" },
  { type: "status", phase: "planning", message: "Designing your landing page…" },
  { type: "meta", meta: { name: "Ember & Oak", summary: "Soy candles.", tagline: "Light one" } },
  { type: "theme", theme: DEFAULT_THEME },
  { type: "status", phase: "writing" },
  { type: "file_start", path: "components/Hero.tsx" },
  { type: "file_delta", path: "components/Hero.tsx", delta: HERO.slice(0, 20) },
  { type: "file_delta", path: "components/Hero.tsx", delta: HERO.slice(20) },
  { type: "file_complete", path: "components/Hero.tsx", content: HERO },
  { type: "text", delta: "Done — a warm, quiet palette." },
  { type: "status", phase: "complete" },
  {
    type: "done",
    files: { "components/Hero.tsx": HERO },
    theme: DEFAULT_THEME,
    meta: { name: "Ember & Oak", summary: "Soy candles." },
    versionId: "3f1c8a6e-0000-4000-8000-000000000001",
    projectId: "3f1c8a6e-0000-4000-8000-000000000002",
  },
];

const NDJSON = EVENTS.map(encodeGenerationEvent).join("");

/** A ReadableStream that hands the payload over in fixed-size byte slices. */
function byteStream(text, sliceSize) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + sliceSize));
      offset += sliceSize;
    },
  });
}

async function collect(stream) {
  const received = [];
  for await (const event of readGenerationEvents(stream)) received.push(event);
  return received;
}

/* ───────────────────────────────── tests ──────────────────────────────── */

process.stdout.write("\nNDJSON framing\n");

check("every event round-trips through one line", () => {
  for (const event of EVENTS) {
    const line = encodeGenerationEvent(event);
    assert.equal(line.endsWith("\n"), true, "an event line must end with a newline");
    assert.equal(line.slice(0, -1).includes("\n"), false, "an event must occupy exactly one line");
    assert.deepEqual(parseGenerationEvent(line), event);
  }
});

for (const sliceSize of [1, 2, 3, 7, 64, 4096]) {
  await checkAsync(`stream split into ${sliceSize}-byte chunks`, async () => {
    const received = await collect(byteStream(NDJSON, sliceSize));
    assert.deepEqual(received, EVENTS);
  });
}

await checkAsync("a final line without a trailing newline still parses", async () => {
  const received = await collect(byteStream(`${NDJSON.slice(0, -1)}`, 5));
  assert.deepEqual(received, EVENTS);
});

await checkAsync("blank lines and keep-alive noise are skipped", async () => {
  const noisy = NDJSON.split("\n").join("\n\n");
  const received = await collect(byteStream(noisy, 11));
  assert.deepEqual(received, EVENTS);
});

process.stdout.write("\naccumulator\n");

await checkAsync("folding the stream rebuilds the FileMap from deltas alone", async () => {
  let state = createGenerationStreamState();
  for await (const event of readGenerationEvents(byteStream(NDJSON, 3))) {
    if (event.type === "file_complete" || event.type === "done") continue;
    state = applyGenerationEvent(state, event);
  }
  assert.deepEqual(state.files, { "components/Hero.tsx": HERO });
  assert.deepEqual(state.pending, ["components/Hero.tsx"]);
  assert.equal(state.phase, "complete");
  assert.equal(state.text, "Done — a warm, quiet palette.");
});

await checkAsync("the done event is authoritative and clears pending files", async () => {
  let state = createGenerationStreamState();
  for await (const event of readGenerationEvents(byteStream(NDJSON, 97))) {
    state = applyGenerationEvent(state, event);
  }
  assert.deepEqual(state.files, { "components/Hero.tsx": HERO });
  assert.deepEqual(state.pending, []);
  assert.equal(state.done, true);
  assert.equal(state.error, null);
  assert.equal(state.versionId, "3f1c8a6e-0000-4000-8000-000000000001");
});

check("refine keeps the base tree as the starting state", () => {
  const state = createGenerationStreamState({ files: { "app/page.tsx": "old\n" }, meta: DEFAULT_META });
  assert.deepEqual(state.files, { "app/page.tsx": "old\n" });
  const next = applyGenerationEvent(state, {
    type: "file_complete",
    path: "components/Hero.tsx",
    content: HERO,
  });
  assert.deepEqual(next.files, { "app/page.tsx": "old\n", "components/Hero.tsx": HERO });
});

check("an error event is terminal", () => {
  const state = applyGenerationEvent(createGenerationStreamState(), {
    type: "error",
    code: "rate_limited",
    message: "429",
    retryable: true,
  });
  assert.equal(state.done, true);
  assert.equal(state.error?.code, "rate_limited");
});

process.stdout.write("\nprompts\n");

check("page type is a hard constraint, not a hint", () => {
  const landing = buildSystemPrompt("landing", "create");
  const product = buildSystemPrompt("product", "create");

  assert.match(landing, /components\/Features\.tsx/);
  assert.match(landing, /components\/Testimonials\.tsx/);
  assert.equal(landing.includes("components/AddToCart.tsx"), false);
  assert.equal(landing.includes("components/Gallery.tsx"), false);

  assert.match(product, /components\/AddToCart\.tsx/);
  assert.match(product, /components\/Gallery\.tsx/);
  assert.match(product, /components\/Specs\.tsx/);
  assert.equal(product.includes("components/Testimonials.tsx"), false);

  assert.notEqual(landing, product);
});

check("both prompts carry the format, image and styling contracts", () => {
  for (const pageType of ["landing", "product"]) {
    const prompt = buildSystemPrompt(pageType, "create");
    assert.match(prompt, /<file path="THE\/PATH\.tsx">/);
    assert.match(prompt, /<meta>/);
    assert.match(prompt, /<theme>/);
    assert.match(prompt, /picsum\.photos\/seed/);
    assert.match(prompt, /Unsplash[\s\S]{0,200}FORBIDDEN/);
    assert.match(prompt, /Tailwind utility classes for 100% of the styling/);
    assert.match(prompt, /No CSS files/);
    assert.match(prompt, /Mobile first/);
    assert.match(prompt, /Zero external UI or utility libraries/);
    assert.match(prompt, /use client/);
  }
});

check("mode changes the contract", () => {
  const create = buildSystemPrompt("landing", "create");
  const refine = buildSystemPrompt("landing", "refine");
  assert.match(create, /THIS TURN: CREATE/);
  assert.match(refine, /THIS TURN: REFINE/);
  assert.match(refine, /Emit ONLY the files the requested change actually touches/);
});

check("the user turns carry what each mode needs", () => {
  const create = buildCreateMessage("product", "a shop selling cast iron skillets");
  assert.match(create, /cast iron skillets/);
  assert.match(create, /components\/Gallery\.tsx/);

  const refine = buildRefineMessage({
    pageType: "landing",
    instruction: "make the hero full-screen",
    files: { "components/Hero.tsx": HERO, "app/page.tsx": "page\n" },
    theme: DEFAULT_THEME,
  });
  assert.match(refine, /make the hero full-screen/);
  assert.match(refine, /<file path="components\/Hero\.tsx">/);
  assert.match(refine, /<file path="app\/page\.tsx">/);

  const repair = buildRepairMessage({
    pageType: "landing",
    missing: ["components/Testimonials.tsx"],
    files: { "components/Hero.tsx": HERO },
    theme: DEFAULT_THEME,
  });
  assert.match(repair, /MISSING FILES/);
  assert.match(repair, /- components\/Testimonials\.tsx/);
  assert.match(repair, /do not emit <meta> or <theme>/);
});

process.stdout.write("\nattached photos\n");

const PHOTO = {
  id: "a1",
  url: "https://abcxyz.supabase.co/storage/v1/object/public/shop-assets/user/project/bottle.webp",
  path: "user/project/bottle.webp",
  name: "matte-black-bottle.jpg",
  mimeType: "image/webp",
  width: 1568,
  height: 1176,
  size: 148_221,
};

check("attachments replace the placeholder rules rather than sitting beside them", () => {
  const withPhotos = buildSystemPrompt("product", "create", true);
  const without = buildSystemPrompt("product", "create", false);

  assert.match(withPhotos, /The attached images are the REAL product/);
  assert.match(withPhotos, /Use every attached URL at least once/);
  // The placeholder instruction must not survive as a competing rule; it may
  // only appear as the fallback for images the user did not supply.
  assert.equal(/^- Every image is a plain <img src="https:\/\/picsum/m.test(withPhotos), false);
  assert.match(withPhotos, /fall back to https:\/\/picsum\.photos/);

  assert.match(without, /Every image is a plain <img src="https:\/\/picsum/);
  assert.equal(without.includes("The attached images are the REAL product"), false);
});

check("the photo manifest reaches every turn that can need it", () => {
  const create = buildCreateMessage("product", "a bottle shop", undefined, [PHOTO]);
  assert.match(create, /ATTACHED PHOTOS — 1 image/);
  assert.match(create, /src: https:\/\/abcxyz\.supabase\.co\/storage/);
  assert.match(create, /1568×1176/);
  assert.match(create, /matte-black-bottle\.jpg/);

  const refine = buildRefineMessage({
    pageType: "product",
    instruction: "swap the hero photo",
    files: { "components/Gallery.tsx": HERO },
    theme: DEFAULT_THEME,
    attachments: [PHOTO],
  });
  assert.match(refine, /ATTACHED PHOTOS/);
  assert.match(refine, /src: https:\/\/abcxyz\.supabase\.co\/storage/);

  const repair = buildRepairMessage({
    pageType: "product",
    missing: ["components/Gallery.tsx"],
    files: {},
    theme: DEFAULT_THEME,
    attachments: [PHOTO],
  });
  assert.match(repair, /ATTACHED PHOTOS/);
});

check("no attachments leaves every turn exactly as it was", () => {
  assert.equal(buildCreateMessage("landing", "a candle shop").includes("ATTACHED PHOTOS"), false);
  assert.equal(
    buildRefineMessage({
      pageType: "landing",
      instruction: "bigger hero",
      files: { "components/Hero.tsx": HERO },
      theme: DEFAULT_THEME,
    }).includes("ATTACHED PHOTOS"),
    false,
  );
});

check("only storage URLs on the configured project are accepted", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcxyz.supabase.co";

  try {
    assert.deepEqual(parseAttachments([PHOTO])[0]?.url, PHOTO.url);
    assert.deepEqual(parseAttachments(undefined), []);

    // A URL somewhere else entirely would make the generator fetch, and the
    // generated page load, whatever an attacker chose.
    for (const url of [
      "https://evil.example.com/shop-assets/x.webp",
      "http://abcxyz.supabase.co/storage/v1/object/public/shop-assets/x.webp",
      "https://abcxyz.supabase.co/storage/v1/object/public/other-bucket/x.webp",
      "not a url",
    ]) {
      assert.throws(() => parseAttachments([{ ...PHOTO, url }]), /shop-assets URL/);
    }

    assert.throws(() => parseAttachments(Array(9).fill(PHOTO)), /at most/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
