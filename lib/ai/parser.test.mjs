import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test for the incremental streaming parser. No dependencies, no network,
 * no Anthropic call — it replays a fixture payload through the parser split at
 * pathological boundaries and asserts the reconstructed FileMap is byte-identical
 * every single time.
 *
 * Run it with:
 *   node lib/ai/parser.test.mjs
 *
 * `register` teaches Node the project's `@/*` alias; Node itself strips the types
 * out of the .ts sources.
 */

register("./alias-hooks.mjs", import.meta.url);
const { StreamingFileParser, canonicaliseFileBody, heldBackLength } = await import("./parser.ts");

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const META = {
  name: "Ember & Oak",
  summary: "Hand-poured soy candles for people who like their evenings slow.",
  tagline: "Light one, slow down",
};

const THEME_INPUT = {
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

/**
 * Every awkward thing a real file body contains: a "use client" directive, a
 * generic type argument (an unescaped `<`), JSX with self-closing tags, a
 * template literal, an inline SVG, a comparison operator, and a lone `<` in a
 * string that must not be mistaken for a tag.
 */
const EXPECTED_FILES = {
  "app/page.tsx": `import Hero from "@/components/Hero";
import Gallery from "@/components/Gallery";

export default function Page() {
  return (
    <main className="min-h-screen bg-[#FFFFFF] font-['Inter',sans-serif]">
      <Hero />
      <Gallery />
    </main>
  );
}
`,
  "components/Hero.tsx": `export default function Hero() {
  const seed = "ember-oak-hero";
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="font-['Fraunces',serif] text-4xl text-[#14181C]">Slow evenings, lit properly</h1>
      <p className="mt-4 text-[#6B7280]">Poured in small batches. Ships in 48 hours.</p>
      <img
        src={\`https://picsum.photos/seed/\${seed}/1200/800\`}
        alt="A lit soy candle on a walnut side table"
        width={1200}
        height={800}
        className="mt-10 w-full object-cover"
      />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path d="M4 12h16" />
      </svg>
    </section>
  );
}
`,
  "components/Gallery.tsx": `"use client";

import { useState } from "react";

type Shot = { seed: string; alt: string };

const SHOTS: Array<Shot> = [
  { seed: "ember-oak-one", alt: "Candle beside a linen throw" },
  { seed: "ember-oak-two", alt: "Wick close-up" },
];

export default function Gallery() {
  const [active, setActive] = useState<number>(0);
  const shot = SHOTS[active] ?? SHOTS[0];
  const label = "widths < 640px stack";

  return (
    <section aria-label={label} className="mx-auto max-w-6xl px-4">
      <img src={\`https://picsum.photos/seed/\${shot.seed}/900/900\`} alt={shot.alt} width={900} height={900} />
      <div className="mt-3 flex gap-3">
        {SHOTS.map((item, index) => (
          <button
            key={item.seed}
            type="button"
            onClick={() => setActive(index)}
            className={index === active ? "ring-2 ring-[#1B4332]" : "opacity-70"}
          >
            <img src={\`https://picsum.photos/seed/\${item.seed}/120/120\`} alt="" width={120} height={120} />
          </button>
        ))}
      </div>
    </section>
  );
}
`,
};

/** The payload exactly as the model streams it: tags, newlines, trailing prose. */
const PAYLOAD = [
  `<meta>${JSON.stringify(META)}</meta>`,
  `<theme>${JSON.stringify(THEME_INPUT)}</theme>`,
  ...Object.entries(EXPECTED_FILES).map(
    ([path, contents]) => `<file path="${path}">\n${contents}</file>`,
  ),
  "",
].join("\n");

/** The same three files, but with the model's habitual ``` fences and blank lines. */
const FENCED_PAYLOAD = [
  `<meta>${JSON.stringify(META)}</meta>`,
  `<theme>${JSON.stringify(THEME_INPUT)}</theme>`,
  ...Object.entries(EXPECTED_FILES).map(
    ([path, contents]) => `<file path="${path}">\n\n\`\`\`tsx\n${contents}\`\`\`\n</file>`,
  ),
  "Let me know if you'd like a different palette!",
].join("\n");

/* ──────────────────────────────── harness ─────────────────────────────── */

let checks = 0;
let failures = 0;

function check(label, fn) {
  checks += 1;
  try {
    fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL ${label}\n       ${error.message.split("\n").join("\n       ")}\n`);
  }
}

/** Runs a payload through the parser using a caller-supplied chunking strategy. */
function replay(payload, chunk) {
  const parser = new StreamingFileParser();
  const events = [];
  for (const piece of chunk(payload)) {
    events.push(...parser.push(piece));
  }
  events.push(...parser.finish());
  return { events, result: parser.result, parser };
}

const byChars = (size) => (payload) => {
  const pieces = [];
  for (let i = 0; i < payload.length; i += size) pieces.push(payload.slice(i, i + size));
  return pieces;
};

const byRandom = (seed) => (payload) => {
  // Deterministic LCG so a failure is always reproducible.
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const pieces = [];
  let i = 0;
  while (i < payload.length) {
    const size = 1 + Math.floor(next() * 40);
    pieces.push(payload.slice(i, i + size));
    i += size;
  }
  return pieces;
};

/** Splits so that every known tag literal straddles a chunk boundary. */
const byTagBoundaries = (payload) => {
  const pieces = [];
  let cursor = 0;
  const tags = ["<meta>", "</meta>", "<theme>", "</theme>", '<file path="', "</file>"];
  for (;;) {
    let best = -1;
    let bestTag = "";
    for (const tag of tags) {
      const at = payload.indexOf(tag, cursor);
      if (at !== -1 && (best === -1 || at < best)) {
        best = at;
        bestTag = tag;
      }
    }
    if (best === -1) break;
    // Cut in the middle of the tag itself, then again one character later.
    const mid = best + Math.max(1, Math.floor(bestTag.length / 2));
    pieces.push(payload.slice(cursor, mid));
    pieces.push(payload.slice(mid, mid + 1));
    cursor = mid + 1;
  }
  pieces.push(payload.slice(cursor));
  return pieces.filter((piece) => piece.length > 0);
};

function assertFilesMatch(result, label) {
  assert.deepEqual(
    Object.keys(result.files).sort(),
    Object.keys(EXPECTED_FILES).sort(),
    `${label}: wrong set of paths`,
  );
  for (const [path, expected] of Object.entries(EXPECTED_FILES)) {
    const actual = result.files[path];
    assert.equal(typeof actual, "string", `${label}: ${path} missing`);
    if (actual !== expected) {
      const at = [...expected].findIndex((ch, i) => ch !== actual[i]);
      throw new Error(
        `${label}: ${path} differs at index ${at}\n  expected: ${JSON.stringify(expected.slice(Math.max(0, at - 30), at + 30))}\n  actual:   ${JSON.stringify(actual.slice(Math.max(0, at - 30), at + 30))}`,
      );
    }
  }
}

/** Concatenated file_delta events must add up to the file_complete content. */
function assertDeltasReconstruct(events, label) {
  const deltas = {};
  const completed = {};
  for (const event of events) {
    if (event.type === "file_delta") deltas[event.path] = (deltas[event.path] ?? "") + event.delta;
    if (event.type === "file_complete") completed[event.path] = event.content;
  }
  for (const [path, content] of Object.entries(completed)) {
    assert.equal(deltas[path], content, `${label}: deltas for ${path} do not reconstruct the file`);
  }
}

/* ───────────────────────────────── tests ──────────────────────────────── */

process.stdout.write("\nStreamingFileParser\n");

check("whole payload in one push", () => {
  const { events, result } = replay(PAYLOAD, (payload) => [payload]);
  assertFilesMatch(result, "one push");
  assertDeltasReconstruct(events, "one push");
  assert.equal(result.truncated, false);
});

check("one character at a time (the pathological case)", () => {
  const { events, result } = replay(PAYLOAD, byChars(1));
  assertFilesMatch(result, "1-char chunks");
  assertDeltasReconstruct(events, "1-char chunks");
  assert.equal(result.truncated, false);
  assert.equal(result.meta.name, META.name);
  assert.equal(result.theme.colors.primary, THEME_INPUT.colors.primary);
});

for (const size of [2, 3, 5, 7, 13, 64, 997]) {
  check(`fixed ${size}-character chunks`, () => {
    const { events, result } = replay(PAYLOAD, byChars(size));
    assertFilesMatch(result, `${size}-char chunks`);
    assertDeltasReconstruct(events, `${size}-char chunks`);
  });
}

for (const seed of [1, 42, 1337, 90210]) {
  check(`random chunk sizes (seed ${seed})`, () => {
    const { events, result } = replay(PAYLOAD, byRandom(seed));
    assertFilesMatch(result, `seed ${seed}`);
    assertDeltasReconstruct(events, `seed ${seed}`);
  });
}

check("every tag split across a chunk boundary", () => {
  const { events, result } = replay(PAYLOAD, byTagBoundaries);
  assertFilesMatch(result, "tag boundaries");
  assertDeltasReconstruct(events, "tag boundaries");
});

check("code fences and trailing prose are stripped", () => {
  const { result } = replay(FENCED_PAYLOAD, byChars(1));
  assertFilesMatch(result, "fenced");
  assert.match(result.text, /different palette/);
  assert.equal(result.truncated, false);
});

check("fenced payload survives tag-boundary splitting too", () => {
  const { result } = replay(FENCED_PAYLOAD, byTagBoundaries);
  assertFilesMatch(result, "fenced + boundaries");
});

check("events arrive in a usable order", () => {
  const { events } = replay(PAYLOAD, byChars(3));
  const types = events.map((event) => event.type);
  assert.equal(types[0], "meta");
  assert.equal(types[1], "theme");

  const open = new Set();
  const seen = [];
  for (const event of events) {
    if (event.type === "file_start") {
      assert.equal(open.has(event.path), false, "file_start twice for the same path");
      open.add(event.path);
      seen.push(event.path);
    }
    if (event.type === "file_delta") assert.equal(open.has(event.path), true, "delta before file_start");
    if (event.type === "file_complete") {
      assert.equal(open.has(event.path), true, "file_complete before file_start");
      open.delete(event.path);
    }
  }
  assert.deepEqual(seen, Object.keys(EXPECTED_FILES), "files did not arrive in emission order");
  assert.equal(open.size, 0, "a file never completed");
});

check("no file_delta ever leaks a tag fragment", () => {
  const { events } = replay(PAYLOAD, byChars(1));
  for (const event of events) {
    if (event.type !== "file_delta") continue;
    assert.equal(event.delta.includes("</file>"), false, "closing tag leaked into a delta");
    assert.equal(event.delta.includes('<file path="'), false, "opening tag leaked into a delta");
  }
});

check("truncation mid-file drops the partial file and is reported", () => {
  const cut = PAYLOAD.indexOf("<svg viewBox");
  const { result } = replay(PAYLOAD.slice(0, cut), byChars(1));
  assert.equal(result.truncated, true);
  assert.equal(result.truncatedPath, "components/Hero.tsx");
  assert.deepEqual(Object.keys(result.files), ["app/page.tsx"]);
});

check("prose before the first tag is reported as text, not swallowed", () => {
  const { result } = replay(`Sure! Here you go:\n${PAYLOAD}`, byChars(1));
  assertFilesMatch(result, "leading prose");
  assert.match(result.text, /Sure! Here you go/);
});

check("malformed <meta> JSON is ignored instead of throwing", () => {
  const { result } = replay(`<meta>{"name": oops}</meta>\n${PAYLOAD}`, byChars(1));
  assert.equal(result.meta.name, META.name, "the later valid meta should win");
});

check("single quotes and stray whitespace in the open tag still parse", () => {
  const payload = `<file path='components/Footer.tsx' >\nexport default function Footer() {\n  return <footer />;\n}\n</file>`;
  const { result } = replay(payload, byChars(1));
  assert.deepEqual(Object.keys(result.files), ["components/Footer.tsx"]);
  assert.equal(
    result.files["components/Footer.tsx"],
    "export default function Footer() {\n  return <footer />;\n}\n",
  );
});

check("an unknown < in prose is not mistaken for a tag", () => {
  const { result } = replay(`a < b and <div>x</div>\n${PAYLOAD}`, byChars(1));
  assertFilesMatch(result, "prose with angle brackets");
});

process.stdout.write("\nhelpers\n");

check("canonicaliseFileBody is idempotent", () => {
  for (const contents of Object.values(EXPECTED_FILES)) {
    assert.equal(canonicaliseFileBody(contents), contents);
    assert.equal(canonicaliseFileBody(`\n\n${contents}\n\n`), contents);
    assert.equal(canonicaliseFileBody(`\`\`\`tsx\n${contents}\`\`\``), contents);
    assert.equal(canonicaliseFileBody(contents.replace(/\n/g, "\r\n")), contents);
  }
  assert.equal(canonicaliseFileBody("   \n\n  "), "");
});

check("heldBackLength withholds partial closing tags", () => {
  assert.equal(heldBackLength("const a = 1;</fi"), 4);
  assert.equal(heldBackLength("const a = 1;<"), 1);
  assert.equal(heldBackLength("const a = 1;"), 0);
  assert.equal(heldBackLength("const a = 1;\n```"), 4);
});

/* ──────────────────────────────── summary ─────────────────────────────── */

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
