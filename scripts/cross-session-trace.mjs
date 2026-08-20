import { randomUUID } from "node:crypto";
import { register } from "node:module";

/**
 * Traces the cross-session case end to end: a shop built yesterday, and a
 * brand-new chat tomorrow asking for "the same one, different name".
 *
 * `investigation-trace.mjs` proves the model can find its way around the shop
 * it is *currently* editing. This proves the harder one, and the only one that
 * needs code out of the database: nothing is loaded, no tree has been posted,
 * the prompt names no project — and the model still has to work out which of
 * several past shops is meant, from the dates, and then read that shop's actual
 * components so the new page can be those components with the brand swapped.
 *
 * Real Claude, real graph. The one thing it cannot do for real is the Postgres
 * read: `loadPastPageSource` goes through `createSupabaseServerClient`, which
 * reads the session cookie of an HTTP request, and a script has no request. So
 * the `source` half of the past-work context is served from the same FileMap
 * that was ingested, and the ownership check that guards it in production is
 * covered by `lib/ai/past-work.test.mjs` and by the account-isolation case in
 * `hydra:check` instead. Everything else here — which shop the model picks, on
 * what evidence, which files it opens, and what reaches the writing prompt — is
 * the real thing.
 *
 * Everything written is deleted at the end.
 *
 *   node --env-file=.env.local scripts/cross-session-trace.mjs "<instruction>"
 */

register("../lib/ai/alias-hooks.mjs", import.meta.url);

const instruction =
  process.argv[2] ?? "create a website same as yesterday, take the same UI, just change the name to Apple";

const { ingestGeneration } = await import("@/lib/hydra/ingest");
const { hydraQuery } = await import("@/lib/hydra/client");
const { graphId, nodeKey } = await import("@/lib/hydra/ids");
const { extractConcepts } = await import("@/lib/hydra/concepts");
const { getComponentInventory, getPastShops } = await import("@/lib/hydra/inspect");
const { recallProject } = await import("@/lib/hydra/retrieve");
const { LABEL } = await import("@/lib/hydra/schema");
const { createAnthropicClient, runToolLoop } = await import("@/lib/ai/client");
const { createInvestigator } = await import("@/lib/ai/investigate");
const { INVESTIGATION_MODEL } = await import("@/lib/ai/model");
const { buildCreateMessage } = await import("@/lib/ai/prompts/index");

/* ────────────────────── two shops, built days apart ────────────────────── */

const SECTIONS = ["Navbar", "Hero", "Features", "Testimonials", "CTA", "Footer"];

const VERDANT_COPY = {
  Navbar:
    '<nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6"><span className="font-[\'Fraunces\',serif] text-xl tracking-tight text-[#1B4332]">Verdant</span><div className="flex gap-8 text-sm text-[#141A16]"><a href="#shop">Shop</a><a href="#about">About</a></div></nav>',
  Hero: '<section className="bg-[#1B4332] px-6 py-32"><div className="mx-auto max-w-4xl text-center"><h1 className="font-[\'Fraunces\',serif] text-6xl leading-tight text-white">Organic skincare for sensitive skin</h1><p className="mt-6 text-lg text-[#F1EFE7]">Cold-pressed botanicals, nothing else.</p><button className="mt-10 rounded-lg bg-[#C9A227] px-8 py-4 text-[#141A16]">Shop the range</button></div></section>',
  Features:
    '<section className="mx-auto max-w-6xl px-6 py-24"><h2 className="font-[\'Fraunces\',serif] text-4xl text-[#1B4332]">Cold-pressed botanicals</h2><div className="mt-12 grid grid-cols-3 gap-8"><div className="rounded-lg bg-[#F1EFE7] p-8">Single origin</div><div className="rounded-lg bg-[#F1EFE7] p-8">No fillers</div><div className="rounded-lg bg-[#F1EFE7] p-8">Refillable</div></div></section>',
  Testimonials:
    '<section className="mx-auto max-w-6xl px-6 py-24"><h2 className="font-[\'Fraunces\',serif] text-4xl text-[#1B4332]">What people say</h2></section>',
  CTA: '<section className="bg-[#1B4332] px-6 py-24 text-center"><h2 className="font-[\'Fraunces\',serif] text-4xl text-white">Start your ritual</h2><button className="mt-8 rounded-lg bg-[#C9A227] px-8 py-4 text-[#141A16]">Get started</button></section>',
  Footer:
    '<footer className="border-t border-[#E3E0D6] px-6 py-12"><div className="mx-auto max-w-7xl text-sm text-[#141A16]">Verdant — organic skincare, made in Devon.</div></footer>',
};

function treeFrom(copy) {
  const files = {
    "app/page.tsx": `${SECTIONS.map((name) => `import ${name} from "@/components/${name}";`).join("\n")}

export default function Page() {
  return (
    <main className="min-h-screen bg-white">
${SECTIONS.map((name) => `      <${name} />`).join("\n")}
    </main>
  );
}
`,
  };
  for (const name of SECTIONS) {
    files[`components/${name}.tsx`] = `export default function ${name}() {\n  return (\n    ${copy[name]}\n  );\n}\n`;
  }
  return files;
}

const verdantFiles = treeFrom(VERDANT_COPY);

const emberFiles = treeFrom(
  Object.fromEntries(
    Object.entries(VERDANT_COPY).map(([name, markup]) => [
      name,
      markup.replace(/Verdant/g, "Ember & Oak").replace(/#1B4332/g, "#7A3E1D"),
    ]),
  ),
);

const verdantTheme = {
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

const emberTheme = { ...verdantTheme, colors: { ...verdantTheme.colors, primary: "#7A3E1D" } };

/* ─────────── three past sessions, the newest of them yesterday ─────────── */

const DAY = 86_400_000;
const now = Date.now();

const userId = randomUUID();

const SHOPS = [
  {
    label: "session 1 — three weeks ago",
    projectId: randomUUID(),
    sessionId: randomUUID(),
    versionId: randomUUID(),
    name: "Ember & Oak",
    summary: "Hand-poured soy candles for slow evenings.",
    prompt: "A landing page for a candle studio selling hand-poured soy candles.",
    files: emberFiles,
    theme: emberTheme,
    createdAt: now - 21 * DAY,
  },
  {
    label: "session 2 — last week",
    projectId: randomUUID(),
    sessionId: randomUUID(),
    versionId: randomUUID(),
    name: "Halyard",
    summary: "Waxed canvas bags built for the coast.",
    prompt: "A landing page for a workshop selling waxed canvas bags and totes.",
    files: treeFrom(
      Object.fromEntries(
        Object.entries(VERDANT_COPY).map(([name, markup]) => [
          name,
          markup.replace(/Verdant/g, "Halyard").replace(/#1B4332/g, "#243B53"),
        ]),
      ),
    ),
    theme: { ...verdantTheme, colors: { ...verdantTheme.colors, primary: "#243B53" } },
    createdAt: now - 7 * DAY,
  },
  {
    label: "session 3 — YESTERDAY",
    projectId: randomUUID(),
    sessionId: randomUUID(),
    versionId: randomUUID(),
    name: "Verdant",
    summary: "Organic skincare for sensitive skin.",
    prompt: "A landing page for an organic skincare brand selling cold-pressed serums.",
    files: verdantFiles,
    theme: verdantTheme,
    createdAt: now - DAY,
  },
];

process.stdout.write("\nseeding three past sessions into the graph\n");
for (const shop of SHOPS) {
  const written = await ingestGeneration({
    userId,
    projectId: shop.projectId,
    projectName: shop.name,
    sessionId: shop.sessionId,
    versionId: shop.versionId,
    pageType: "landing",
    prompt: shop.prompt,
    mode: "create",
    files: shop.files,
    theme: shop.theme,
    meta: { name: shop.name, summary: shop.summary },
    createdAt: shop.createdAt,
  });
  process.stdout.write(
    `  ${written ? "ok" : "FAILED"}  ${shop.label.padEnd(26)} "${shop.name}" — ${shop.summary}\n`,
  );
}

/* ─────────── session 4: a new project, nothing loaded, no tree ─────────── */

const newProjectId = randomUUID();

process.stdout.write(`\nsession 4 — a brand-new, empty project (${newProjectId.slice(0, 8)}…)\n`);
process.stdout.write(`instruction: "${instruction}"\n`);
process.stdout.write("(no baseFiles, no project named, nothing loaded in the browser)\n\n");

const recalled = await recallProject({
  userId,
  prompt: instruction,
  excludeProjectId: newProjectId,
  now,
});

if (!recalled) {
  process.stdout.write("RECALL FOUND NOTHING — the investigation has nothing to point at.\n\n");
} else {
  process.stdout.write("─── what recall resolved, before Claude was called ───\n");
  process.stdout.write(`  shop:     ${recalled.name} (${recalled.projectId})\n`);
  process.stdout.write(`  matched:  ${recalled.matchedConcepts.join(", ") || "—"}\n`);
  process.stdout.write(`  dated by: ${recalled.timePhrase ?? "—"}\n`);
  process.stdout.write(`  palette:  ${recalled.theme.colors.primary}\n`);
}

/* ───────────────────── the past-work tools, wired live ─────────────────── */

const seededSource = new Map(SHOPS.map((shop) => [`${shop.projectId}:landing`, shop.files]));

const pastWork = async ({ recalled: target }) => {
  const shops = await getPastShops({ userId, excludeProjectId: newProjectId });
  return {
    shops: shops.some((shop) => shop.projectId === target.projectId)
      ? shops
      : [
          {
            projectId: target.projectId,
            name: target.name,
            summary: target.summary,
            updatedAt: target.updatedAt,
            pages: [],
          },
          ...shops,
        ],
    now,
    components: (projectId, pageType) => getComponentInventory(projectId, pageType),
    // Stands in for `loadPastPageSource`, which needs a request's cookies.
    source: async (projectId, pageType) => seededSource.get(`${projectId}:${pageType}`) ?? {},
  };
};

const calls = [];
const client = createAnthropicClient(process.env.ANTHROPIC_API_KEY);

const investigate = createInvestigator(
  (params) =>
    runToolLoop({
      client,
      model: INVESTIGATION_MODEL,
      ...params,
      onToolCall: (name, input) => {
        calls.push({ name, input });
        params.onToolCall?.(name, input);
      },
    }),
  pastWork,
);

const started = Date.now();
const result = recalled
  ? await investigate({
      body: {
        pageType: "landing",
        prompt: instruction,
        mode: "create",
        projectId: newProjectId,
        sessionId: randomUUID(),
      },
      recalled,
      onStatus: (message) => process.stdout.write(`  status: ${message}\n`),
    })
  : null;
const elapsed = Date.now() - started;

if (!result) {
  process.stdout.write("\nNO INVESTIGATION HAPPENED — graph empty or unreachable\n\n");
} else {
  process.stdout.write(`\n─── tool calls the model made (${calls.length}) ───\n`);
  for (const call of calls) {
    const args = call.input && Object.keys(call.input).length > 0 ? ` ${JSON.stringify(call.input)}` : "";
    process.stdout.write(`  ${call.name}${args}\n`);
  }

  process.stdout.write("\n─── the shops it was choosing between ───\n");
  for (const shop of await getPastShops({ userId, excludeProjectId: newProjectId })) {
    const days = Math.round((now - shop.updatedAt) / DAY);
    process.stdout.write(
      `  ${String(days).padStart(2)} days ago  ${shop.name.padEnd(14)} ${shop.projectId}\n`,
    );
  }

  const code = result.recalledCode;
  process.stdout.write("\n─── which past shop it settled on, and what it opened ───\n");
  if (!code) {
    process.stdout.write("  it opened nothing\n");
  } else {
    const picked = SHOPS.find((shop) => shop.projectId === code.projectId);
    const days = picked ? Math.round((now - picked.createdAt) / DAY) : null;
    process.stdout.write(
      `  ${picked?.name ?? code.projectId} — ${code.pageType} page, built ${days} day${days === 1 ? "" : "s"} ago\n`,
    );
    process.stdout.write(`  correct shop: ${picked?.name === "Verdant" ? "YES" : "NO"}\n\n`);
    for (const source of code.sources) {
      process.stdout.write(`  read  ${source.path.padEnd(28)} ${source.contents.length} chars\n`);
    }
  }

  process.stdout.write(`\n─── the brief it wrote ───\n${result.plan}\n`);

  /* ─────────── and what all of that turns into for the writing turn ─────── */

  const memory = {
    inherited: null,
    contextPaths: null,
    recalled: {
      ...recalled,
      ...(code ? { sources: code.sources, sourcePageType: code.pageType } : {}),
    },
  };

  const message = buildCreateMessage("landing", instruction, memory, [], result.plan);
  const section = message.slice(
    message.indexOf("## YOU HAVE BUILT FOR THIS USER BEFORE"),
    message.indexOf("Emit <meta>"),
  );

  process.stdout.write(`\n─── the writing turn's prompt (${message.length} chars) ───\n`);
  process.stdout.write(`${section.trim()}\n`);

  process.stdout.write(`\n${elapsed}ms, ${result.toolCalls} tool calls\n`);
}

/* ──────────────────────────────── cleanup ─────────────────────────────── */

for (const shop of SHOPS) {
  await hydraQuery(`MATCH (n:${LABEL.component} {project_id: $project_id}) DETACH DELETE n`, {
    project_id: shop.projectId,
  });
}

const ids = [
  graphId(nodeKey.user(userId)),
  ...SHOPS.flatMap((shop) => [
    graphId(nodeKey.project(shop.projectId)),
    graphId(nodeKey.session(shop.sessionId)),
    graphId(nodeKey.generation(shop.versionId)),
  ]),
  ...extractConcepts(
    SHOPS.map((shop) => `${shop.prompt} ${shop.name} ${shop.summary}`).join(" "),
  ).map((concept) => graphId(nodeKey.concept(userId, concept.key))),
];
for (const id of ids) await hydraQuery("MATCH (n {id: $id}) DETACH DELETE n", { id });

process.stdout.write("\ncleaned up\n\n");
