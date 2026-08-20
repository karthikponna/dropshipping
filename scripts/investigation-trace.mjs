import { randomUUID } from "node:crypto";
import { register } from "node:module";

/**
 * Traces one real investigation turn end to end and prints what it asked for.
 *
 * `hydra:check` proves the graph reads work but never calls Claude. This calls
 * the real model against the real graph, so it answers the only question that
 * actually matters: given a deliberately vague instruction, does the model use
 * the tools, does it find the earlier turn the instruction refers to, and does
 * it open the right file.
 *
 * It seeds its own project, session and history rather than borrowing a real
 * one — a graph node id is a one-way hash, so the browser's session uuid cannot
 * be recovered from the graph, and `versions` is behind RLS. Everything written
 * is deleted at the end.
 *
 *   node --env-file=.env.local scripts/investigation-trace.mjs "<instruction>"
 */

register("../lib/ai/alias-hooks.mjs", import.meta.url);

const instruction = process.argv[2] ?? "now make that section narrower";

const { ingestGeneration } = await import("@/lib/hydra/ingest");
const { hydraQuery } = await import("@/lib/hydra/client");
const { graphId, nodeKey } = await import("@/lib/hydra/ids");
const { LABEL } = await import("@/lib/hydra/schema");
const { createAnthropicClient, runToolLoop } = await import("@/lib/ai/client");
const { createInvestigator } = await import("@/lib/ai/investigate");
const { INVESTIGATION_MODEL } = await import("@/lib/ai/model");

/* ─────────────────────────── a plausible shop ──────────────────────────── */

const SECTIONS = ["Navbar", "Hero", "Features", "Testimonials", "CTA", "Footer"];

const COPY = {
  Navbar: '<nav className="flex h-16 items-center justify-between px-6">Verdant</nav>',
  Hero: '<section className="mx-auto max-w-7xl bg-[#1B4332] px-6 py-32"><h1 className="text-5xl">Organic skincare for sensitive skin</h1><button className="rounded-lg bg-white px-6 py-3">Shop now</button></section>',
  Features: '<section className="mx-auto max-w-6xl px-6 py-20"><h2>Cold-pressed botanicals</h2></section>',
  Testimonials: '<section className="mx-auto max-w-6xl px-6 py-20"><h2>What people say</h2></section>',
  CTA: '<section className="mx-auto max-w-4xl px-6 py-20"><h2>Start your ritual</h2><button className="rounded-lg px-6 py-3">Get started</button></section>',
  Footer: '<footer className="border-t px-6 py-12">Verdant</footer>',
};

const files = {
  "app/page.tsx": `${SECTIONS.map((name) => `import ${name} from "@/components/${name}";`).join("\n")}

export default function Page() {
  return (
    <main>
${SECTIONS.map((name) => `      <${name} />`).join("\n")}
    </main>
  );
}
`,
};
for (const name of SECTIONS) {
  files[`components/${name}.tsx`] = `export default function ${name}() {\n  return (\n    ${COPY[name]}\n  );\n}\n`;
}

const theme = {
  colors: {
    primary: "#1B4332",
    secondary: "#F1EFE7",
    accent: "#C9A227",
    background: "#FFFFFF",
    foreground: "#141A16",
  },
  fonts: { heading: "Fraunces", body: "Inter" },
  radius: "0.5rem",
};

/* ─────────────── three turns, exactly like the browser test ────────────── */

const userId = randomUUID();
const projectId = randomUUID();
const sessionId = randomUUID();
const versionIds = [randomUUID(), randomUUID(), randomUUID()];
const now = Date.now();

const TURNS = [
  { prompt: "A landing page for an organic skincare brand selling cold-pressed serums.", mode: "create" },
  { prompt: "make the hero background a deep forest green", mode: "refine" },
  { prompt: "make that section's heading text larger", mode: "refine" },
];

process.stdout.write("\nseeding a three-turn session into the graph\n");
for (const [index, turn] of TURNS.entries()) {
  const written = await ingestGeneration({
    userId,
    projectId,
    projectName: "Verdant",
    sessionId,
    versionId: versionIds[index],
    pageType: "landing",
    prompt: turn.prompt,
    mode: turn.mode,
    files,
    theme,
    meta: { name: "Verdant", summary: "Organic skincare for sensitive skin." },
    ...(index > 0 ? { previousVersionId: versionIds[index - 1] } : {}),
    createdAt: now - (TURNS.length - index) * 60_000,
  });
  process.stdout.write(`  turn ${index + 1} ${written ? "ok" : "FAILED"} — "${turn.prompt}"\n`);
}

/* ───────────────────────── the investigation turn ──────────────────────── */

process.stdout.write(`\nturn 4 instruction: "${instruction}"\n`);
process.stdout.write("(deliberately vague — nothing in it names a component)\n\n");

const calls = [];
const client = createAnthropicClient(process.env.ANTHROPIC_API_KEY);

const investigate = createInvestigator((params) =>
  runToolLoop({
    client,
    model: INVESTIGATION_MODEL,
    ...params,
    onToolCall: (name, input) => {
      calls.push({ name, input });
      params.onToolCall?.(name, input);
    },
  }),
);

const started = Date.now();
const result = await investigate({
  body: { pageType: "landing", prompt: instruction, mode: "refine", projectId, sessionId, baseFiles: files },
  onStatus: (message) => process.stdout.write(`  status: ${message}\n`),
});
const elapsed = Date.now() - started;

if (!result) {
  process.stdout.write("\nNO INVESTIGATION HAPPENED — graph empty or unreachable\n\n");
} else {
  process.stdout.write(`\n─── tool calls the model made (${calls.length}) ───\n`);
  for (const call of calls) {
    const args = call.input && Object.keys(call.input).length > 0 ? ` ${JSON.stringify(call.input)}` : "";
    process.stdout.write(`  ${call.name}${args}\n`);
  }

  process.stdout.write(`\n─── session history it read back (${result.history.length} turns) ───\n`);
  for (const [index, turn] of result.history.entries()) {
    process.stdout.write(`  ${index + 1}. (${turn.mode}) ${turn.prompt}\n`);
  }

  process.stdout.write(`\n─── files it will send to the writing turn ───\n`);
  for (const path of result.contextPaths ?? ["<no narrowing: all 8 files>"]) {
    process.stdout.write(`  ${path}\n`);
  }

  process.stdout.write(`\n─── the brief it wrote ───\n${result.plan}\n`);
  process.stdout.write(`\n${elapsed}ms, ${result.toolCalls} tool calls\n`);
}

/* ──────────────────────────────── cleanup ─────────────────────────────── */

const { extractConcepts } = await import("@/lib/hydra/concepts");

await hydraQuery(`MATCH (n:${LABEL.component} {project_id: $project_id}) DETACH DELETE n`, {
  project_id: projectId,
});

const ids = [
  graphId(nodeKey.user(userId)),
  graphId(nodeKey.project(projectId)),
  graphId(nodeKey.session(sessionId)),
  ...versionIds.map((id) => graphId(nodeKey.generation(id))),
  ...extractConcepts(
    "organic skincare brand cold-pressed serums hero forest green heading Verdant sensitive skin landing page",
  ).map((concept) => graphId(nodeKey.concept(userId, concept.key))),
];
for (const id of ids) await hydraQuery("MATCH (n {id: $id}) DETACH DELETE n", { id });

process.stdout.write("\ncleaned up\n\n");
