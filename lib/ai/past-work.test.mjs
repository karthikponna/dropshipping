import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test of the cross-session path — the one where a brand-new chat says
 * "the same as yesterday, just change the name" and the model has to find,
 * read and adapt a shop nobody has loaded.
 *
 * No network, no Anthropic call, no HydraDB node and no Supabase. The three
 * things worth pinning are all pure: the tools that answer questions about past
 * shops, the prompt block that carries their source, and the pipeline ordering
 * that makes recall run before the investigation it feeds.
 *
 * Run it with:
 *   node lib/ai/past-work.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const {
  runToolCall,
  PAST_WORK_TOOLS,
  PAST_TOOL_NAMES,
  MAX_FILES_PER_INVESTIGATION,
  MAX_PAST_FILES_PER_INVESTIGATION,
  MAX_PAST_FILES_PER_READ,
} = await import("./tools.ts");
const { renderRecalledProject } = await import("./prompts/memory.ts");
const { buildCreateMessage, MAX_RECALLED_SOURCE_CHARS } = await import("./prompts/index.ts");
const { runGenerationPipeline } = await import("./pipeline.ts");
const { LANDING_REQUIRED_FILES } = await import("@/lib/framework");
const { describeShops } = await import("@/lib/hydra/concepts.ts");

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

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-19T12:00:00.000Z");

function bodyFor(path) {
  const name = path.split("/").pop().replace(".tsx", "");
  const component = name === "page" ? "Page" : name;
  return `export default function ${component}() {\n  return <section className="mx-auto max-w-6xl px-6 py-20">Verdant ${component}</section>;\n}\n`;
}

const PAST_FILES = Object.fromEntries(LANDING_REQUIRED_FILES.map((path) => [path, bodyFor(path)]));

const PAST_INVENTORY = LANDING_REQUIRED_FILES.map((path, index) => ({
  id: index + 1,
  path,
  name: path.split("/").pop().replace(".tsx", ""),
  purpose: `The ${path} slot.`,
  isEntry: path === "app/page.tsx",
  isClient: false,
  lineCount: 3,
}));

const YESTERDAY_ID = "11111111-1111-4111-8111-111111111111";
const LAST_MONTH_ID = "22222222-2222-4222-8222-222222222222";

const SHOPS = [
  {
    projectId: YESTERDAY_ID,
    name: "Verdant",
    summary: "Organic skincare for sensitive skin.",
    updatedAt: NOW - DAY,
    pages: [{ pageType: "landing", versionId: "v-yesterday", builtAt: NOW - DAY, generations: 2 }],
  },
  {
    projectId: LAST_MONTH_ID,
    name: "Ember & Oak",
    summary: "Hand-poured soy candles.",
    updatedAt: NOW - 30 * DAY,
    pages: [{ pageType: "landing", versionId: "v-old", builtAt: NOW - 30 * DAY, generations: 1 }],
  },
];

/** Stands in for Postgres: only the shop that exists answers, and only its page. */
function pastContext(overrides = {}) {
  return {
    shops: SHOPS,
    now: NOW,
    components: async (projectId, pageType) =>
      projectId === YESTERDAY_ID && pageType === "landing" ? PAST_INVENTORY : [],
    source: async (projectId, pageType) =>
      projectId === YESTERDAY_ID && pageType === "landing" ? PAST_FILES : {},
    ...overrides,
  };
}

function contextWith(past = pastContext()) {
  return { files: {}, inventory: [], history: [], related: async () => [], past };
}

const parse = (outcome) => JSON.parse(outcome.content);

const RECALLED = {
  projectId: YESTERDAY_ID,
  name: "Verdant",
  summary: "Organic skincare for sensitive skin.",
  theme: {
    colors: { primary: "#2F5D3A" },
    fonts: { heading: "Fraunces", body: "Inter" },
    radius: "0.25rem",
  },
  matchedConcepts: ["organic skincare", "skincare"],
  timePhrase: "yesterday",
  updatedAt: NOW - DAY,
};

const SOURCES = ["app/page.tsx", "components/Hero.tsx", "components/Navbar.tsx"].map((path) => ({
  path,
  contents: PAST_FILES[path],
}));

/* ──────────────────────────── the tool surface ─────────────────────────── */

process.stdout.write("\npast-work tools\n");

await check("every tool declares a name, a description and an object schema", async () => {
  assert.equal(PAST_WORK_TOOLS.length, 3);
  for (const tool of PAST_WORK_TOOLS) {
    assert.ok(tool.name.length > 0, "a tool needs a name");
    assert.ok(tool.description.length > 40, `${tool.name} needs a description the model can act on`);
    assert.equal(tool.inputSchema.type, "object");
  }
  const names = PAST_WORK_TOOLS.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...Object.values(PAST_TOOL_NAMES)].sort());
});

await check("past_shops dates every shop, which is what 'yesterday' resolves against", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.shops,
    input: {},
    context: contextWith(),
  });
  const { shops, today } = parse(outcome);

  assert.equal(outcome.isError, false);
  assert.equal(today, "2026-08-19");
  assert.equal(shops.length, 2);

  const yesterday = shops.find((shop) => shop.project_id === YESTERDAY_ID);
  assert.equal(yesterday.days_ago, 1, "the shop built yesterday must read as one day ago");
  assert.equal(yesterday.name, "Verdant");
  assert.equal(yesterday.pages[0].built_on, "2026-08-18");
  assert.equal(yesterday.pages[0].revisions, 2);

  const older = shops.find((shop) => shop.project_id === LAST_MONTH_ID);
  assert.equal(older.days_ago, 30, "the other shop must be distinguishable by date alone");
});

/* ─────────────────────── which shop the request means ──────────────────── */

process.stdout.write("\nchoosing between past shops\n");

const NAMELESS_ID = "33333333-3333-4333-8333-333333333333";

/** Newest of the three, and says nothing about itself. */
const NAMELESS = {
  projectId: NAMELESS_ID,
  name: "Untitled",
  summary: "",
  updatedAt: NOW - 60_000,
  pages: [{ pageType: "landing", versionId: "v-new", builtAt: NOW - 60_000, generations: 1 }],
};

async function rankFor(request, shops) {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.shops,
    input: {},
    context: contextWith(pastContext({ shops, describedBy: describeShops(shops, request) })),
  });
  return parse(outcome).shops;
}

await check("a described shop outranks a newer one the request says nothing about", async () => {
  const shops = [NAMELESS, ...SHOPS];
  const ranked = await rankFor("rebuild the soy candle shop I made yesterday, call it Apple", shops);

  assert.equal(ranked[0].project_id, LAST_MONTH_ID, "the candle shop is the one described");
  assert.deepEqual(ranked[0].matches_request, ["soy candles", "soy", "candles"]);
  assert.equal(
    ranked[0].days_ago,
    30,
    "and it wins while being a month old against something from a minute ago",
  );
  assert.deepEqual(
    ranked.slice(1).map((shop) => shop.project_id),
    [NAMELESS_ID, YESTERDAY_ID],
    "the shops it does not describe fall in behind it, newest first",
  );
});

await check("a described shop outranks a newer one described differently", async () => {
  const ranked = await rankFor("another organic skincare site, but call it Apple", SHOPS);

  assert.equal(ranked[0].project_id, YESTERDAY_ID, "skincare names the skincare shop");
  assert.ok(ranked[0].matches_request.includes("organic skincare"));
  assert.equal(
    ranked[1].matches_request,
    undefined,
    "a shop the request does not describe carries no match at all",
  );
});

// The fallback's territory: the request reaches back but describes nothing, so
// there is no reading of it under which the date is the wrong signal.
await check("with nothing described, the newest shop leads", async () => {
  const shops = [...SHOPS, NAMELESS];
  const ranked = await rankFor("same as yesterday, take the same UI, just change the name to Apple", shops);

  assert.equal(ranked[0].project_id, NAMELESS_ID);
  assert.deepEqual(
    ranked.map((shop) => shop.days_ago),
    [0, 1, 30],
    "and the rest fall in recency order behind it",
  );
  for (const shop of ranked) assert.equal(shop.matches_request, undefined);
});

await check("a date never disqualifies the shop the request describes", async () => {
  // The literal reading of "yesterday" is the nameless shop from a minute ago;
  // the honest reading is the candle shop the user actually named.
  const shops = [NAMELESS, ...SHOPS];
  const matches = describeShops(shops, "the hand-poured candle shop from yesterday");

  assert.ok(matches.has(LAST_MONTH_ID), "a month-old shop stays eligible when it is the one described");
  assert.equal(matches.has(NAMELESS_ID), false);
});

await check("past_shops says so plainly when there is nothing to reach back at", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.shops,
    input: {},
    context: contextWith(pastContext({ shops: [] })),
  });
  const result = parse(outcome);
  assert.deepEqual(result.shops, []);
  assert.match(result.note, /earlier session/i);
});

await check("past_components reports metadata and never source", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.components,
    input: { project_id: YESTERDAY_ID, page_type: "landing" },
    context: contextWith(),
  });
  const { components } = parse(outcome);

  assert.equal(components.length, LANDING_REQUIRED_FILES.length);
  assert.equal(components.find((component) => component.entry === true).path, "app/page.tsx");
  assert.equal(outcome.content.includes("export default function"), false, "no file bodies here");
});

await check("past_components points elsewhere when that page was never built", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.components,
    input: { project_id: YESTERDAY_ID, page_type: "product" },
    context: contextWith(),
  });
  const result = parse(outcome);
  assert.deepEqual(result.components, []);
  assert.match(result.note, /no product page/i);
});

await check("read_past_files returns real source and reports where it came from", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.read,
    input: {
      project_id: YESTERDAY_ID,
      page_type: "landing",
      paths: ["app/page.tsx", "components/Hero.tsx"],
    },
    context: contextWith(),
  });
  const { files } = parse(outcome);

  assert.equal(outcome.isError, false);
  assert.equal(files["components/Hero.tsx"], PAST_FILES["components/Hero.tsx"]);
  assert.deepEqual(outcome.read, ["app/page.tsx", "components/Hero.tsx"]);
  assert.equal(outcome.past.projectId, YESTERDAY_ID);
  assert.equal(outcome.past.pageType, "landing");
  assert.equal(outcome.past.sources.length, 2, "the caller needs the source, not just the paths");
});

await check("read_past_files serves the paths it recognises and flags the rest", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.read,
    input: {
      project_id: YESTERDAY_ID,
      page_type: "landing",
      paths: ["components/Hero.tsx", "components/Newsletter.tsx"],
    },
    context: contextWith(),
  });
  const result = parse(outcome);

  assert.equal(outcome.isError, false, "one bad path must not sink the whole call");
  assert.deepEqual(Object.keys(result.files), ["components/Hero.tsx"]);
  assert.deepEqual(result.notFound, ["components/Newsletter.tsx"]);
});

await check("a project the reader will not open returns nothing, not somebody's files", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.read,
    input: {
      project_id: "33333333-3333-4333-8333-333333333333",
      page_type: "landing",
      paths: ["app/page.tsx"],
    },
    context: contextWith(),
  });

  assert.equal(outcome.isError, true);
  assert.equal(outcome.past, undefined, "a refused read must not report source it never got");
  assert.match(parse(outcome).error, /no saved source/i);
});

await check("one call reads a whole shop — the budget is not what stops it", async () => {
  assert.ok(
    MAX_PAST_FILES_PER_READ >= LANDING_REQUIRED_FILES.length,
    `a whole landing page must fit one call: ${MAX_PAST_FILES_PER_READ} < ${LANDING_REQUIRED_FILES.length}`,
  );
  assert.ok(
    MAX_PAST_FILES_PER_INVESTIGATION > MAX_FILES_PER_INVESTIGATION,
    "copying a page needs a wider budget than refining one",
  );

  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.read,
    input: { project_id: YESTERDAY_ID, page_type: "landing", paths: [...LANDING_REQUIRED_FILES] },
    context: contextWith(),
  });

  assert.equal(outcome.isError, false);
  assert.deepEqual(
    Object.keys(parse(outcome).files).sort(),
    [...LANDING_REQUIRED_FILES].sort(),
    "every section of the page must come back, not a sample of them",
  );
  assert.equal(outcome.past.sources.length, LANDING_REQUIRED_FILES.length);
});

await check("read_past_files refuses once the file budget is spent", async () => {
  const spent = Array.from(
    { length: MAX_PAST_FILES_PER_INVESTIGATION },
    (_, index) => `components/Spent${index}.tsx`,
  );

  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.read,
    input: { project_id: YESTERDAY_ID, page_type: "landing", paths: ["components/Hero.tsx"] },
    context: contextWith(),
    alreadyRead: spent,
  });

  assert.equal(outcome.isError, true);
  assert.match(parse(outcome).error, /limit/i);
  assert.deepEqual(outcome.read, [], "a refused call must not count as a read");
});

await check("a malformed page type is an error the model can recover from", async () => {
  const outcome = await runToolCall({
    name: PAST_TOOL_NAMES.read,
    input: { project_id: YESTERDAY_ID, page_type: "checkout", paths: ["app/page.tsx"] },
    context: contextWith(),
  });
  assert.equal(outcome.isError, true);
  assert.match(parse(outcome).error, /landing, product/);
});

await check("the past tools refuse outright on a turn that has no past context", async () => {
  for (const name of Object.values(PAST_TOOL_NAMES)) {
    const outcome = await runToolCall({
      name,
      input: { project_id: YESTERDAY_ID, page_type: "landing", paths: ["app/page.tsx"] },
      context: { files: {}, inventory: [], history: [], related: async () => [] },
    });
    assert.equal(outcome.isError, true, `${name} answered without a past-work context`);
  }
});

/* ─────────────────────── the recalled project prompt ───────────────────── */

process.stdout.write("\nrecalled source in the prompt\n");

await check("a recall with no source is worded exactly as it was before", async () => {
  const rendered = renderRecalledProject(RECALLED);
  assert.match(rendered, /YOU HAVE BUILT FOR THIS USER BEFORE/);
  assert.match(rendered, /Continue that shop rather than inventing a new one/);
  assert.equal(rendered.includes("<file path="), false, "there was no source to quote");
});

await check("a recall with source quotes it and says to edit it, not imitate it", async () => {
  const rendered = renderRecalledProject({
    ...RECALLED,
    sources: SOURCES,
    sourcePageType: "landing",
  });

  assert.match(rendered, /ITS ACTUAL COMPONENTS/);
  assert.match(rendered, /<file path="components\/Hero\.tsx">/);
  assert.match(rendered, /Verdant Hero/, "the real body has to be in there, not a summary of it");
  assert.match(rendered, /editing these, not by designing a new one/);
  assert.match(rendered, /same Tailwind class lists/);
  assert.match(rendered, /the new request wins/i, "the new prompt must still beat the old shop");
  assert.match(rendered, /reference, not output/, "it must still emit the whole page");

  // The theme contract is the weaker half of the same instruction; dropping it
  // when source arrives would lose the exact hex values the model must type.
  assert.match(rendered, /bg-\[#2F5D3A\]/);
});

await check("an ordinary shop is quoted whole — the cap is a backstop, not a filter", async () => {
  // Roughly the size of a real generated landing page: eight files, ~60k chars.
  const shop = LANDING_REQUIRED_FILES.map((path) => ({
    path,
    contents: `// ${path}\n${"x".repeat(7_000)}\n`,
  }));
  const rendered = renderRecalledProject({ ...RECALLED, sources: shop, sourcePageType: "landing" });

  for (const path of LANDING_REQUIRED_FILES) {
    assert.ok(rendered.includes(`<file path="${path}">`), `${path} was dropped from the prompt`);
  }
  assert.equal(rendered.includes("TRUNCATED"), false, "a shop this size must arrive intact");
});

await check("a past shop too large to quote is trimmed rather than sent whole", async () => {
  const huge = LANDING_REQUIRED_FILES.map((path) => ({
    path,
    contents: `// ${path}\n${"x".repeat(30_000)}\n`,
  }));
  const rendered = renderRecalledProject({ ...RECALLED, sources: huge, sourcePageType: "landing" });

  assert.ok(
    rendered.length < MAX_RECALLED_SOURCE_CHARS + 4_000,
    `the whole shop reached the prompt: ${rendered.length} chars`,
  );
  assert.match(rendered, /TRUNCATED/, "the model must be told it is seeing part of the page");
});

await check("what survives a truncation is the page's skeleton, not its alphabet", async () => {
  const huge = LANDING_REQUIRED_FILES.map((path) => ({
    path,
    contents: `// ${path}\n${"x".repeat(30_000)}\n`,
  }));
  const rendered = renderRecalledProject({ ...RECALLED, sources: huge, sourcePageType: "landing" });

  assert.ok(
    rendered.includes('<file path="app/page.tsx">'),
    "the entry file decides the section order and must never be the one dropped",
  );
  assert.ok(
    rendered.includes('<file path="components/Navbar.tsx">'),
    "the top of the page outranks the bottom of it",
  );
  // Alphabetical order would have kept CTA.tsx and dropped app/page.tsx.
  assert.match(rendered, /TRUNCATED:[\s\S]*components\/CTA\.tsx/);
});

await check("the create turn carries the source, the theme and the brief", async () => {
  const message = buildCreateMessage(
    "landing",
    "create a website same as yesterday, take the same UI, just change the name to Apple",
    {
      inherited: null,
      contextPaths: null,
      recalled: { ...RECALLED, sources: SOURCES, sourcePageType: "landing" },
    },
    [],
    "This is Verdant, built 2026-08-18. Keep every section and class list; rename the brand to Apple everywhere.",
  );

  assert.match(message, /SHOP DESCRIPTION/);
  assert.match(message, /<file path="app\/page\.tsx">/);
  assert.match(message, /WHAT TO CARRY OVER/);
  assert.match(message, /rename the brand to Apple everywhere/);
  assert.ok(
    message.indexOf("ITS ACTUAL COMPONENTS") < message.indexOf("WHAT TO CARRY OVER"),
    "the brief interprets the source, so it belongs after it",
  );
  assert.ok(
    message.indexOf("WHAT TO CARRY OVER") < message.indexOf("Start your reply with <meta>"),
    "the emission contract stays last",
  );
});

await check("a create turn with no memory is byte-identical to the old prompt", async () => {
  assert.equal(
    buildCreateMessage("landing", "a candle shop"),
    buildCreateMessage("landing", "a candle shop", undefined, [], ""),
    "the new inputs must be inert when empty",
  );
});

/* ──────────────────────── the pipeline integration ─────────────────────── */

process.stdout.write("\ncross-session recall in the pipeline\n");

const WHOLE_PAGE = LANDING_REQUIRED_FILES.map(
  (path) => `<file path="${path}">\n${bodyFor(path)}</file>`,
).join("\n");

function fakeModel() {
  const calls = [];
  const streamText = async ({ system, userMessage, onTextDelta }) => {
    calls.push({ system, userMessage });
    onTextDelta(WHOLE_PAGE);
    return { stopReason: "end_turn" };
  };
  return { streamText, calls };
}

const CREATE_BODY = {
  pageType: "landing",
  prompt: "create a website same as yesterday, take the same UI, just change the name to Apple",
  mode: "create",
  projectId: "44444444-4444-4444-8444-444444444444",
  sessionId: "session-4",
};

async function runCreate({ investigate, recalled = RECALLED }) {
  const events = [];
  const model = fakeModel();
  const seen = [];

  await runGenerationPipeline({
    body: CREATE_BODY,
    write: (event) => events.push(event),
    streamText: model.streamText,
    investigate: async (params) => {
      seen.push(params);
      return investigate(params);
    },
    recall: async () => ({
      memory: { inherited: null, recalled, contextPaths: null },
      notices: [],
    }),
  });

  return { events, calls: model.calls, seen };
}

await check("recall runs first, and hands the shop it found to the investigation", async () => {
  const { seen } = await runCreate({
    investigate: async () => null,
  });

  assert.equal(seen.length, 1, "the create turn must be investigated once");
  assert.equal(seen[0].recalled.projectId, YESTERDAY_ID, "the investigation needs the project id");
  assert.equal(seen[0].body.mode, "create");
});

await check("what the investigation read reaches the writing turn as source", async () => {
  const { events, calls } = await runCreate({
    investigate: async () => ({
      plan: "This is Verdant from 2026-08-18. Same sections, rename to Apple.",
      contextPaths: null,
      history: [],
      toolCalls: 4,
      recalledCode: {
        projectId: YESTERDAY_ID,
        name: "Verdant",
        pageType: "landing",
        sources: SOURCES,
      },
    }),
  });

  const prompt = calls[0].userMessage;
  assert.match(prompt, /ITS ACTUAL COMPONENTS/);
  assert.match(prompt, /<file path="components\/Navbar\.tsx">/);
  assert.match(prompt, /Same sections, rename to Apple/);

  const phases = events.filter((event) => event.type === "status").map((event) => event.phase);
  assert.ok(phases.includes("investigating"), "the phase must reach the client");

  // Naming the shop is the whole point: a recall that picked the wrong one of
  // three is otherwise invisible until the finished page arrives.
  const notice = events
    .filter((event) => event.type === "memory")
    .map((event) => event.memory)
    .find((memory) => memory.kind === "recalled-project" && /Building from/.test(memory.message));

  assert.ok(notice, "the rail must be told whose code is being reused");
  assert.match(notice.message, /Building from "Verdant" — read 3 files of its landing page\./);
  assert.match(notice.detail, /components\/Navbar\.tsx/);
  assert.equal(notice.projectId, YESTERDAY_ID, "the notice has to link to the shop it names");
});

// Recall proposes a shop from the prompt's wording; the investigation gets the
// dated list and can overrule it. When that happens the rail has already told
// the user one name, so the read has to correct it rather than confirm it.
await check("a read from a different shop than recall named says so", async () => {
  const { events } = await runCreate({
    investigate: async () => ({
      plan: "The shop dated yesterday is Cinder, not Verdant.",
      contextPaths: null,
      history: [],
      toolCalls: 3,
      recalledCode: {
        projectId: LAST_MONTH_ID,
        name: "Cinder",
        pageType: "landing",
        sources: SOURCES,
      },
    }),
  });

  const notices = events.filter((event) => event.type === "memory").map((event) => event.memory);
  const read = notices.find((memory) => /Building from/.test(memory.message));

  assert.match(read.message, /Building from "Cinder" instead — read 3 files of its landing page\./);
  assert.equal(read.projectId, LAST_MONTH_ID, "the link must go to the shop that was read");
  assert.equal(
    read.message.includes("Verdant"),
    false,
    "the shop recall proposed must not be the one credited for the code",
  );
});

await check("an investigation that read nothing still reports what it did", async () => {
  const { events } = await runCreate({
    investigate: async () => ({
      plan: "Nothing worth copying.",
      contextPaths: null,
      history: [],
      toolCalls: 4,
      recalledCode: null,
    }),
  });

  const notice = events
    .filter((event) => event.type === "memory")
    .map((event) => event.memory)
    .find((memory) => memory.kind === "consulted-graph");

  assert.match(notice.message, /4 lookups/);
});

await check("an investigation that opened nothing still leaves the theme contract", async () => {
  const { calls } = await runCreate({
    investigate: async () => ({
      plan: "",
      contextPaths: null,
      history: [],
      toolCalls: 1,
      recalledCode: null,
    }),
  });

  const prompt = calls[0].userMessage;
  assert.equal(prompt.includes("ITS ACTUAL COMPONENTS"), false);
  assert.match(prompt, /YOU HAVE BUILT FOR THIS USER BEFORE/);
  assert.match(prompt, /bg-\[#2F5D3A\]/, "the palette must survive a failed source read");
});

await check("a create turn recall found nothing for is never investigated", async () => {
  const { seen, calls } = await runCreate({
    investigate: async () => {
      throw new Error("the investigation ran with nothing to investigate");
    },
    recalled: null,
  });

  assert.deepEqual(seen, []);
  assert.equal(calls[0].userMessage.includes("YOU HAVE BUILT FOR THIS USER BEFORE"), false);
});

await check("an investigation that fails outright still builds the site", async () => {
  const { events, calls } = await runCreate({ investigate: async () => null });

  assert.match(calls[0].userMessage, /YOU HAVE BUILT FOR THIS USER BEFORE/);
  assert.equal(events[events.length - 1].type, "done");
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
