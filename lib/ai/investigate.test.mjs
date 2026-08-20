import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test of the investigation turn — the pass where Claude queries the
 * memory graph before a refinement is written.
 *
 * No network, no Anthropic call and no HydraDB node. The tool dispatcher is
 * pure, so it runs against fixtures directly; the loop itself is exercised by
 * injecting a scripted `investigate` into the real pipeline, which is what
 * proves the narrowed file set and the brief actually reach the writing turn.
 *
 * Run it with:
 *   node lib/ai/investigate.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const { runToolCall, INSPECTION_TOOLS, TOOL_NAMES, MAX_FILES_PER_INVESTIGATION } = await import("./tools.ts");
const { contextPathsFrom } = await import("./investigate.ts");
const { buildRefineMessage, renderSessionHistory } = await import("./prompts/index.ts");
const { runGenerationPipeline } = await import("./pipeline.ts");
const { LANDING_REQUIRED_FILES } = await import("@/lib/framework");

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

function bodyFor(path) {
  const name = path.split("/").pop().replace(".tsx", "");
  const component = name === "page" ? "Page" : name;
  return `export default function ${component}() {\n  return <section>${component}</section>;\n}\n`;
}

const FILES = Object.fromEntries(LANDING_REQUIRED_FILES.map((path) => [path, bodyFor(path)]));

const INVENTORY = LANDING_REQUIRED_FILES.map((path, index) => ({
  id: index + 1,
  path,
  name: path.split("/").pop().replace(".tsx", ""),
  purpose: `The ${path} slot.`,
  isEntry: path === "app/page.tsx",
  isClient: false,
  lineCount: 3,
}));

const HISTORY = [
  {
    versionId: "v1",
    pageType: "landing",
    prompt: "soy candle shop, warm and quiet",
    mode: "create",
    name: "Ember & Oak",
    summary: "Hand-poured soy candles.",
    createdAt: 1,
  },
  {
    versionId: "v2",
    pageType: "landing",
    prompt: "drop the pricing table, we do not want to show prices yet",
    mode: "refine",
    name: "Ember & Oak",
    summary: "Hand-poured soy candles.",
    createdAt: 2,
  },
];

function contextWith(overrides = {}) {
  return {
    files: FILES,
    inventory: INVENTORY,
    history: HISTORY,
    related: async () => [],
    ...overrides,
  };
}

const parse = (outcome) => JSON.parse(outcome.content);

/* ──────────────────────────── the tool surface ─────────────────────────── */

process.stdout.write("\ninvestigation tools\n");

await check("every tool declares a name, a description and an object schema", async () => {
  assert.equal(INSPECTION_TOOLS.length, 4);
  for (const tool of INSPECTION_TOOLS) {
    assert.ok(tool.name.length > 0, "a tool needs a name");
    assert.ok(tool.description.length > 40, `${tool.name} needs a description the model can act on`);
    assert.equal(tool.inputSchema.type, "object");
  }
  const names = INSPECTION_TOOLS.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...Object.values(TOOL_NAMES)].sort());
});

await check("session_history returns every earlier turn, numbered and oldest first", async () => {
  const outcome = await runToolCall({ name: TOOL_NAMES.history, input: {}, context: contextWith() });
  const { turns } = parse(outcome);

  assert.equal(outcome.isError, false);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, 1);
  assert.match(turns[0].asked, /soy candle shop/);
  assert.match(turns[1].asked, /drop the pricing table/);
});

await check("session_history says so plainly when this is the first change", async () => {
  const outcome = await runToolCall({
    name: TOOL_NAMES.history,
    input: {},
    context: contextWith({ history: [] }),
  });
  const result = parse(outcome);
  assert.deepEqual(result.turns, []);
  assert.match(result.note, /first change/i);
});

await check("list_components reports metadata and never source", async () => {
  const outcome = await runToolCall({ name: TOOL_NAMES.components, input: {}, context: contextWith() });
  const { components } = parse(outcome);

  assert.equal(components.length, LANDING_REQUIRED_FILES.length);
  const entry = components.find((component) => component.entry === true);
  assert.equal(entry.path, "app/page.tsx");
  assert.equal(outcome.content.includes("export default function"), false, "no file bodies here");
});

await check("read_files returns full source and records what it handed over", async () => {
  const outcome = await runToolCall({
    name: TOOL_NAMES.read,
    input: { paths: ["components/Hero.tsx"] },
    context: contextWith(),
  });
  const { files } = parse(outcome);

  assert.equal(files["components/Hero.tsx"], FILES["components/Hero.tsx"]);
  assert.deepEqual(outcome.read, ["components/Hero.tsx"]);
});

await check("read_files names what exists when the model invents a path", async () => {
  const outcome = await runToolCall({
    name: TOOL_NAMES.read,
    input: { paths: ["components/Newsletter.tsx"] },
    context: contextWith(),
  });

  assert.equal(outcome.isError, true);
  assert.match(parse(outcome).error, /components\/Hero\.tsx/, "the error must list the real paths");
});

await check("read_files serves the paths it recognises and flags the rest", async () => {
  const outcome = await runToolCall({
    name: TOOL_NAMES.read,
    input: { paths: ["components/Hero.tsx", "components/Newsletter.tsx"] },
    context: contextWith(),
  });
  const result = parse(outcome);

  assert.equal(outcome.isError, false, "one bad path must not sink the whole call");
  assert.deepEqual(Object.keys(result.files), ["components/Hero.tsx"]);
  assert.deepEqual(result.notFound, ["components/Newsletter.tsx"]);
});

await check("read_files refuses once the file budget is spent", async () => {
  const spent = LANDING_REQUIRED_FILES.slice(0, MAX_FILES_PER_INVESTIGATION);
  const outcome = await runToolCall({
    name: TOOL_NAMES.read,
    input: { paths: ["components/Hero.tsx"] },
    context: contextWith(),
    alreadyRead: spent,
  });

  assert.equal(outcome.isError, true);
  assert.match(parse(outcome).error, /limit/i);
  assert.deepEqual(outcome.read, [], "a refused call must not count as a read");
});

await check("related_files walks IMPORTS through the injected traversal", async () => {
  const asked = [];
  const outcome = await runToolCall({
    name: TOOL_NAMES.related,
    input: { paths: ["app/page.tsx"] },
    context: contextWith({
      related: async (paths) => {
        asked.push(...paths);
        return ["components/Hero.tsx"];
      },
    }),
  });

  assert.deepEqual(asked, ["app/page.tsx"]);
  assert.deepEqual(parse(outcome).imports, ["components/Hero.tsx"]);
});

await check("a malformed tool input is an error the model can recover from", async () => {
  const outcome = await runToolCall({
    name: TOOL_NAMES.read,
    input: { paths: "components/Hero.tsx" },
    context: contextWith(),
  });
  assert.equal(outcome.isError, true);
  assert.match(parse(outcome).error, /array/);
});

await check("an unknown tool name is reported rather than thrown", async () => {
  const outcome = await runToolCall({ name: "delete_everything", input: {}, context: contextWith() });
  assert.equal(outcome.isError, true);
});

/* ───────────────────────── choosing the file set ───────────────────────── */

process.stdout.write("\ncontext selection\n");

await check("the entry file joins whatever the investigation opened", async () => {
  const paths = contextPathsFrom(["components/Hero.tsx"], "landing", FILES);
  assert.ok(paths.includes("app/page.tsx"), "a new section has to be wired into the entry file");
  assert.ok(paths.includes("components/Hero.tsx"));
  assert.equal(paths.length, 2);
});

await check("reading nothing means showing everything", async () => {
  assert.equal(contextPathsFrom([], "landing", FILES), null);
});

await check("reading almost everything means showing everything", async () => {
  const nearlyAll = LANDING_REQUIRED_FILES.slice(0, LANDING_REQUIRED_FILES.length - 1);
  assert.equal(contextPathsFrom(nearlyAll, "landing", FILES), null);
});

await check("paths that are not in the tree are dropped", async () => {
  const paths = contextPathsFrom(["components/Hero.tsx", "components/Ghost.tsx"], "landing", FILES);
  assert.equal(paths.includes("components/Ghost.tsx"), false);
});

/* ────────────────────────── the refine prompt ──────────────────────────── */

process.stdout.write("\nsession history in the prompt\n");

await check("history renders oldest first with the page it applied to", async () => {
  const rendered = renderSessionHistory(HISTORY);
  assert.match(rendered, /EARLIER IN THIS SESSION/);
  assert.ok(
    rendered.indexOf("soy candle shop") < rendered.indexOf("drop the pricing table"),
    "oldest turn must come first",
  );
  assert.match(rendered, /landing page/);
  assert.match(rendered, /Do not undo something an earlier turn asked for/);
});

await check("no history renders nothing at all", async () => {
  assert.equal(renderSessionHistory([]), "");
});

await check("the refine turn carries the history, the brief and only the chosen files", async () => {
  const message = buildRefineMessage({
    pageType: "landing",
    instruction: "make that section narrower",
    files: FILES,
    theme: { colors: { primary: "#1B4332" }, fonts: { heading: "Fraunces", body: "Inter" } },
    contextPaths: ["app/page.tsx", "components/Hero.tsx"],
    history: HISTORY,
    plan: "The user means the hero. Only components/Hero.tsx changes; keep the pricing table off the page.",
  });

  assert.match(message, /EARLIER IN THIS SESSION/);
  assert.match(message, /drop the pricing table/, "turn two is what 'that section' resolves against");
  assert.match(message, /WHAT THAT MEANS HERE/);
  assert.match(message, /keep the pricing table off the page/);
  assert.match(message, /FILES RELEVANT TO THIS CHANGE/);
  assert.match(message, /<file path="components\/Hero\.tsx">/);
  assert.equal(
    message.includes('<file path="components/Footer.tsx">'),
    false,
    "an unread file must not be sent",
  );
  assert.match(message, /ALSO ON THIS PAGE[^\n]*components\/Footer\.tsx/);

  assert.ok(
    message.indexOf("CHANGE REQUESTED") < message.indexOf("WHAT THAT MEANS HERE"),
    "the brief belongs next to the instruction it interprets",
  );
});

await check("a refine with no investigation is byte-identical to the old prompt", async () => {
  const shared = {
    pageType: "landing",
    instruction: "make the hero full-screen",
    files: FILES,
    theme: { colors: { primary: "#1B4332" }, fonts: { heading: "Fraunces", body: "Inter" } },
  };
  assert.equal(
    buildRefineMessage(shared),
    buildRefineMessage({ ...shared, history: [], plan: "" }),
    "the new inputs must be inert when empty",
  );
});

/* ──────────────────────── the pipeline integration ─────────────────────── */

process.stdout.write("\ninvestigation in the pipeline\n");

function fakeModel() {
  const calls = [];
  const streamText = async ({ system, userMessage, onTextDelta }) => {
    calls.push({ system, userMessage });
    onTextDelta(`<file path="components/Hero.tsx">\n${bodyFor("components/Hero.tsx")}</file>\n`);
    return { stopReason: "end_turn" };
  };
  return { streamText, calls };
}

const REFINE_BODY = {
  pageType: "landing",
  prompt: "make that section narrower",
  mode: "refine",
  projectId: "project-1",
  sessionId: "session-1",
  baseFiles: FILES,
  baseTheme: { colors: { primary: "#1B4332" }, fonts: { heading: "Fraunces", body: "Inter" } },
};

async function runRefine({ investigate, recall }) {
  const events = [];
  const model = fakeModel();
  await runGenerationPipeline({
    body: REFINE_BODY,
    write: (event) => events.push(event),
    streamText: model.streamText,
    ...(investigate ? { investigate } : {}),
    ...(recall ? { recall } : {}),
  });
  return { events, calls: model.calls };
}

await check("what the investigation read is what the writing turn is shown", async () => {
  const { events, calls } = await runRefine({
    investigate: async () => ({
      plan: "Only the hero changes.",
      contextPaths: ["app/page.tsx", "components/Hero.tsx"],
      history: HISTORY,
      toolCalls: 3,
    }),
  });

  const prompt = calls[0].userMessage;
  assert.match(prompt, /EARLIER IN THIS SESSION/);
  assert.match(prompt, /Only the hero changes/);
  assert.equal(prompt.includes('<file path="components/Footer.tsx">'), false);

  const phaseNames = events.filter((event) => event.type === "status").map((event) => event.phase);
  assert.ok(phaseNames.includes("investigating"), "the phase must reach the client");

  const notice = events.find((event) => event.type === "memory");
  assert.equal(notice.memory.kind, "consulted-graph");
  assert.match(notice.memory.message, /3 lookups/);
  assert.match(notice.memory.detail, /2 earlier turns/);
  assert.match(notice.memory.detail, /2 files/);
});

await check("each tool call is surfaced as a live status line", async () => {
  const { events } = await runRefine({
    investigate: async ({ onStatus }) => {
      onStatus("Reading components/Hero.tsx…");
      return { plan: "", contextPaths: null, history: [], toolCalls: 1 };
    },
  });

  assert.ok(
    events.some(
      (event) =>
        event.type === "status" &&
        event.phase === "investigating" &&
        event.message === "Reading components/Hero.tsx…",
    ),
    "the user should see which file is being opened",
  );
});

await check("an investigation that narrowed suppresses the heuristic narrowing", async () => {
  const seen = [];
  await runRefine({
    investigate: async () => ({
      plan: "Only the hero changes.",
      contextPaths: ["components/Hero.tsx"],
      history: [],
      toolCalls: 2,
    }),
    recall: async (_body, options) => {
      seen.push(options);
      return { memory: { inherited: null, recalled: null, contextPaths: null }, notices: [] };
    },
  });

  assert.deepEqual(seen, [{ narrowContext: false }], "the graph should not be asked the same thing twice");
});

await check("no investigation leaves the heuristic narrowing in charge", async () => {
  const seen = [];
  const { calls } = await runRefine({
    investigate: async () => null,
    recall: async (_body, options) => {
      seen.push(options);
      return {
        memory: { inherited: null, recalled: null, contextPaths: ["components/Hero.tsx"] },
        notices: [],
      };
    },
  });

  assert.deepEqual(seen, [{ narrowContext: true }]);
  assert.match(calls[0].userMessage, /FILES RELEVANT TO THIS CHANGE/);
  assert.equal(calls[0].userMessage.includes("EARLIER IN THIS SESSION"), false);
});

await check("a create turn with nothing to reach back at is never investigated", async () => {
  let ran = false;
  const events = [];
  const wholePage = LANDING_REQUIRED_FILES.map(
    (path) => `<file path="${path}">\n${bodyFor(path)}</file>`,
  ).join("\n");

  await runGenerationPipeline({
    body: { pageType: "landing", prompt: "soy candles", mode: "create" },
    write: (event) => events.push(event),
    streamText: async ({ onTextDelta }) => {
      onTextDelta(wholePage);
      return { stopReason: "end_turn" };
    },
    investigate: async () => {
      ran = true;
      return null;
    },
  });

  assert.equal(ran, false, "a prompt that reaches for nothing has nothing to look up");
  assert.equal(events[events.length - 1].type, "done");
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
