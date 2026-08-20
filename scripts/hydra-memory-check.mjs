import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";

/**
 * End-to-end check of the memory layer against a *running* HydraDB node.
 *
 * `scripts/hydra-probe.sh` pins the Cypher dialect; this pins the behaviour
 * built on top of it — that a product page really does inherit the landing
 * page's design, that a refinement really is narrowed by the import graph, and
 * that "the shop I built yesterday" really resolves to yesterday's shop.
 *
 * It is not part of `npm test`, which must stay offline. Run it with:
 *   npm run hydra:up && npm run hydra:check
 *
 * Every id is per-run random and every node written is deleted at the end, so
 * running it against a graph with real projects in it is safe.
 */

register("../lib/ai/alias-hooks.mjs", import.meta.url);

const { ingestGeneration } = await import("@/lib/hydra/ingest");
const { getInheritedDesign, getCodeContext, recallProject } = await import("@/lib/hydra/retrieve");
const { getComponentInventory, getPastShops, getRelatedPaths, getSessionHistory } =
  await import("@/lib/hydra/inspect");
const { hydraQuery } = await import("@/lib/hydra/client");
const { isHydraConfigured } = await import("@/lib/hydra/config");
const { LABEL } = await import("@/lib/hydra/schema");

if (!isHydraConfigured()) {
  process.stdout.write(
    "\nHYDRADB_URL / HYDRADB_TOKEN are not set, so there is nothing to check.\n" +
      "Start a node with `npm run hydra:up` and copy the HYDRADB_* block from .env.example.\n\n",
  );
  process.exit(1);
}

/* ──────────────────────────────── harness ─────────────────────────────── */

let checks = 0;
let failures = 0;

async function check(label, fn) {
  checks += 1;
  try {
    await fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    const detail = String(error.message).slice(0, 700).split("\n").join("\n       ");
    process.stdout.write(`  FAIL ${label}\n       ${detail}\n`);
  }
}

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const DAY = 86_400_000;
const now = Date.now();
const yesterday = now - DAY;

const userId = randomUUID();
const skincareProjectId = randomUUID();
const candleProjectId = randomUUID();

const landingVersionId = randomUUID();
const productVersionId = randomUUID();
const candleVersionId = randomUUID();

// A second account, so "list this user's past shops" can be shown to be a read
// of *this* user's shops rather than of every shop in the graph.
const strangerId = randomUUID();
const strangerProjectId = randomUUID();
const strangerVersionId = randomUUID();

const skincareTheme = {
  colors: {
    primary: "#2F5D3A",
    secondary: "#F1EFE7",
    accent: "#C9A227",
    background: "#FFFFFF",
    foreground: "#141A16",
  },
  fonts: { heading: "Fraunces", body: "Inter" },
  radius: "0.25rem",
};

const LANDING_SECTIONS = ["Navbar", "Hero", "Features", "Testimonials", "CTA", "Footer"];

function section(name, body) {
  return `export default function ${name}() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h2 className="text-3xl">${body}</h2>
    </section>
  );
}
`;
}

function landingFiles() {
  const files = {
    "app/page.tsx": `${LANDING_SECTIONS.map((name) => `import ${name} from "@/components/${name}";`).join("\n")}

export default function Page() {
  return (
    <main>
${LANDING_SECTIONS.map((name) => `      <${name} />`).join("\n")}
    </main>
  );
}
`,
  };
  files["components/Navbar.tsx"] = section("Navbar", "Verdant");
  files["components/Hero.tsx"] = section("Hero", "Organic skincare for sensitive skin");
  files["components/Features.tsx"] = section("Features", "Cold-pressed botanicals");
  files["components/Testimonials.tsx"] = section("Testimonials", "What people say");
  files["components/CTA.tsx"] = section("CTA", "Start your ritual");
  files["components/Footer.tsx"] = section("Footer", "Verdant");
  return files;
}

const PRODUCT_SECTIONS = [
  "Navbar",
  "Gallery",
  "ProductInfo",
  "PriceBlock",
  "AddToCart",
  "Specs",
  "Reviews",
  "Footer",
];

function productFiles() {
  const files = {
    "app/page.tsx": `${PRODUCT_SECTIONS.map((name) => `import ${name} from "@/components/${name}";`).join("\n")}

export default function Page() {
  return (
    <main>
${PRODUCT_SECTIONS.map((name) => `      <${name} />`).join("\n")}
    </main>
  );
}
`,
  };
  for (const name of PRODUCT_SECTIONS) files[`components/${name}.tsx`] = section(name, name);
  return files;
}

/* ────────────────────────────── the scenario ──────────────────────────── */

process.stdout.write("\nHydraDB memory, against the running node\n");

const sessionOne = randomUUID();
const sessionTwo = randomUUID();

await check("yesterday's landing page ingests", async () => {
  const written = await ingestGeneration({
    userId,
    projectId: skincareProjectId,
    projectName: "Verdant",
    sessionId: sessionOne,
    versionId: landingVersionId,
    pageType: "landing",
    prompt: "A landing page for an organic skincare brand selling cold-pressed serums.",
    mode: "create",
    files: landingFiles(),
    theme: skincareTheme,
    meta: { name: "Verdant", summary: "Organic skincare for sensitive skin." },
    createdAt: yesterday,
  });
  assert.equal(written, true, "the ingest batch did not complete");
});

await check("the product page inherits the landing page's design", async () => {
  const inherited = await getInheritedDesign(skincareProjectId, "landing");
  assert.ok(inherited, "nothing was inherited");
  assert.equal(inherited.versionId, landingVersionId);
  assert.equal(inherited.theme.colors.primary, skincareTheme.colors.primary);
  assert.equal(inherited.theme.fonts.heading, "Fraunces");
  assert.equal(inherited.theme.fonts.body, "Inter");
  assert.equal(inherited.theme.radius, "0.25rem");
  assert.equal(inherited.name, "Verdant");

  // The section list is what lets the new page echo the old one's structure.
  for (const name of ["Hero", "Features", "Footer"]) {
    assert.ok(inherited.components.includes(name), `${name} missing from the inherited sections`);
  }
  assert.equal(inherited.components.includes("Page"), false, "the entry file leaked into the sections");
});

await check("a project with no sibling page inherits nothing", async () => {
  assert.equal(await getInheritedDesign(skincareProjectId, "product"), null);
});

await check("a refinement is narrowed to the section it names", async () => {
  const context = await getCodeContext({
    projectId: skincareProjectId,
    pageType: "landing",
    instruction: "make the hero headline bigger",
    availablePaths: Object.keys(landingFiles()),
  });
  assert.equal(context.narrowed, true, "the import graph did not narrow the context");
  assert.ok(context.paths.includes("components/Hero.tsx"), "the named section was left out");
  assert.ok(context.paths.includes("app/page.tsx"), "the entry file was left out");
  assert.equal(
    context.paths.includes("components/Testimonials.tsx"),
    false,
    "an unrelated section was included",
  );
});

await check("a whole-page instruction is not narrowed", async () => {
  const context = await getCodeContext({
    projectId: skincareProjectId,
    pageType: "landing",
    instruction: "make it feel warmer overall",
    availablePaths: Object.keys(landingFiles()),
  });
  assert.equal(context.narrowed, false, "a vague instruction was narrowed on a guess");
  assert.equal(context.paths.length, Object.keys(landingFiles()).length);
});

await check("the product page ingests, derived from the landing page", async () => {
  const written = await ingestGeneration({
    userId,
    projectId: skincareProjectId,
    projectName: "Verdant",
    sessionId: sessionOne,
    versionId: productVersionId,
    pageType: "product",
    prompt: "A product page for the rosehip repair serum.",
    mode: "create",
    files: productFiles(),
    theme: skincareTheme,
    meta: { name: "Verdant", summary: "Rosehip repair serum." },
    derivedFromVersionId: landingVersionId,
    createdAt: yesterday + 60_000,
  });
  assert.equal(written, true, "the ingest batch did not complete");

  const rows = await hydraQuery(
    `MATCH (p:${LABEL.generation} {version_id: $version})-[:DERIVED_FROM]->(l:${LABEL.generation})
     RETURN l.version_id AS version_id, l.page_type AS page_type`,
    { version: productVersionId },
  );
  assert.equal(rows?.[0]?.version_id, landingVersionId, "DERIVED_FROM did not land");
  assert.equal(rows?.[0]?.page_type, "landing");
});

await check("both pages of the project now resolve each other", async () => {
  const fromProduct = await getInheritedDesign(skincareProjectId, "product");
  assert.equal(fromProduct?.versionId, productVersionId);
  assert.equal(fromProduct?.theme.colors.primary, skincareTheme.colors.primary);
});

/* ─────────────── what the investigation turn asks the graph ────────────── */

process.stdout.write("\nreads the model drives itself\n");

await check("the session's turns come back in the order they happened", async () => {
  const history = await getSessionHistory(sessionOne);

  assert.equal(history.length, 2, `expected both turns of the sitting, got ${history.length}`);
  assert.equal(history[0].versionId, landingVersionId, "oldest turn must be first");
  assert.equal(history[1].versionId, productVersionId);
  assert.equal(history[0].pageType, "landing");
  assert.equal(history[1].pageType, "product");
  assert.match(history[0].prompt, /organic skincare brand/);
  assert.match(history[1].prompt, /rosehip repair serum/);
  assert.equal(history[0].mode, "create");
});

await check("a sitting nobody has generated in has no history", async () => {
  assert.deepEqual(await getSessionHistory(randomUUID()), []);
});

await check("the component inventory is metadata and marks the entry file", async () => {
  const inventory = await getComponentInventory(skincareProjectId, "landing");

  assert.equal(inventory.length, Object.keys(landingFiles()).length);
  const hero = inventory.find((entry) => entry.path === "components/Hero.tsx");
  assert.equal(hero.name, "Hero");
  assert.ok(hero.lineCount > 0, "line counts are what let the model budget its reads");

  const entries = inventory.filter((entry) => entry.isEntry);
  assert.equal(entries.length, 1, "exactly one entry file");
  assert.equal(entries[0].path, "app/page.tsx");
});

await check("related_files walks IMPORTS out from the entry file", async () => {
  const inventory = await getComponentInventory(skincareProjectId, "landing");
  const related = await getRelatedPaths({ inventory, paths: ["app/page.tsx"] });

  for (const name of LANDING_SECTIONS) {
    assert.ok(related.includes(`components/${name}.tsx`), `${name} is imported but was not returned`);
  }
  assert.equal(related.includes("app/page.tsx"), false, "the seed must not come back as its own dependency");
});

await check("a leaf section depends on nothing", async () => {
  const inventory = await getComponentInventory(skincareProjectId, "landing");
  const related = await getRelatedPaths({ inventory, paths: ["components/Hero.tsx"] });
  assert.deepEqual(related, [], "a leaf component should pull in no dependencies");
});

/* ───────────────────── a new session, a new day ───────────────────────── */

await check("a new chat recalls yesterday's shop by description and time", async () => {
  const recalled = await recallProject({
    userId,
    prompt: "rebuild the organic skincare shop I made yesterday, but for candles",
    excludeProjectId: candleProjectId,
    now,
  });

  assert.ok(recalled, "yesterday's project was not recalled");
  assert.equal(recalled.projectId, skincareProjectId);
  assert.equal(recalled.name, "Verdant");
  assert.equal(recalled.theme.colors.primary, skincareTheme.colors.primary);
  assert.equal(recalled.timePhrase, "yesterday");
  assert.ok(recalled.matchedConcepts.length >= 2, "recall fired on a single weak concept");
});

await check("a prompt that does not reach for past work recalls nothing", async () => {
  const recalled = await recallProject({
    userId,
    prompt: "a landing page for an organic skincare brand",
    now,
  });
  assert.equal(recalled, null, "a plain new shop silently inherited an old one");
});

await check("an unrelated prompt does not drag in an unrelated project", async () => {
  const recalled = await recallProject({
    userId,
    prompt: "that motorcycle parts catalogue I built last week",
    now,
  });
  assert.equal(recalled, null, "recall matched a project sharing no concepts");
});

await check("today's shop is ingested and does not displace yesterday's", async () => {
  const written = await ingestGeneration({
    userId,
    projectId: candleProjectId,
    projectName: "Ember & Oak",
    sessionId: sessionTwo,
    versionId: candleVersionId,
    pageType: "landing",
    prompt: "A landing page for a candle studio selling hand-poured soy candles.",
    mode: "create",
    files: landingFiles(),
    theme: { ...skincareTheme, colors: { ...skincareTheme.colors, primary: "#7A3E1D" } },
    meta: { name: "Ember & Oak", summary: "Hand-poured soy candles." },
    createdAt: now,
  });
  assert.equal(written, true);

  const recalled = await recallProject({
    userId,
    prompt: "the organic skincare shop I built yesterday",
    now,
  });
  assert.equal(recalled?.projectId, skincareProjectId, "the newer, unrelated shop won on recency");
});

await check("'same as yesterday' resolves even though it describes no shop", async () => {
  // The request this whole path exists for. Every content word in it is about
  // the new page — take, change, name, Apple — so concept overlap cannot fire,
  // and the referent is the newest thing inside the window instead.
  const recalled = await recallProject({
    userId,
    prompt: "create a website same as yesterday, take the same UI, just change the name to Apple",
    now,
  });

  assert.ok(recalled, "a dated request for the same thing again found nothing");
  assert.equal(recalled.projectId, candleProjectId, "it should resolve to the newest shop in the window");
  assert.equal(recalled.timePhrase, "yesterday");
  assert.deepEqual(recalled.matchedConcepts, [], "nothing in that prompt describes a shop");
  assert.equal(recalled.theme.colors.primary, "#7A3E1D", "the resolved shop's palette came with it");
});

await check("a dated request that names a shop the user never built still finds nothing", async () => {
  // The guard on the fallback above: naming a subject means the subject can be
  // wrong, and the wrong shop is worse than no shop.
  assert.equal(
    await recallProject({ userId, prompt: "that motorcycle parts catalogue I built last week", now }),
    null,
  );
});

await check("'the same as yesterday' outside the window finds nothing", async () => {
  const recalled = await recallProject({
    userId,
    prompt: "build the same thing as yesterday, just rename it",
    now: now + 10 * DAY,
  });
  assert.equal(recalled, null, "a stale graph was passed off as yesterday's work");
});

await check("asking for something new is never answered with the newest shop", async () => {
  assert.equal(
    await recallProject({ userId, prompt: "a landing page for a bike repair studio", now }),
    null,
  );
});

/* ───────────── reusing an earlier shop's code in a new session ─────────── */

process.stdout.write("\nreaching back at an earlier shop's code\n");

await check("every shop the user built is listed, newest first, with its dates", async () => {
  const shops = await getPastShops({ userId });

  assert.equal(shops.length, 2, `expected both shops, got ${shops.length}`);
  assert.equal(shops[0].projectId, candleProjectId, "the newest shop must come first");
  assert.equal(shops[1].projectId, skincareProjectId);

  const skincare = shops[1];
  assert.equal(skincare.name, "Verdant");
  assert.match(skincare.summary, /sensitive skin|Rosehip/);

  // The dates are the whole point: "the same as yesterday" is answered by
  // arithmetic on these, not by matching words in the description.
  const pages = Object.fromEntries(skincare.pages.map((page) => [page.pageType, page]));
  assert.ok(pages.landing, "the landing page is missing from the shop's pages");
  assert.ok(pages.product, "the product page is missing from the shop's pages");
  assert.equal(pages.landing.versionId, landingVersionId);
  assert.equal(
    Math.round((now - pages.landing.builtAt) / DAY),
    1,
    "yesterday's landing page must date to one day ago",
  );
  const candleLanding = shops[0].pages.find((page) => page.pageType === "landing");
  assert.equal(
    Math.round((now - candleLanding.builtAt) / DAY),
    0,
    "today's shop must date to today",
  );
});

await check("the project this prompt is building is left off its own list", async () => {
  const shops = await getPastShops({ userId, excludeProjectId: candleProjectId });
  assert.deepEqual(
    shops.map((shop) => shop.projectId),
    [skincareProjectId],
  );
});

await check("another account's shops are never listed", async () => {
  const written = await ingestGeneration({
    userId: strangerId,
    projectId: strangerProjectId,
    projectName: "Someone Else's Shop",
    sessionId: randomUUID(),
    versionId: strangerVersionId,
    pageType: "landing",
    prompt: "A landing page for an organic skincare brand selling cold-pressed serums.",
    mode: "create",
    files: landingFiles(),
    theme: skincareTheme,
    meta: { name: "Someone Else's Shop", summary: "Organic skincare for sensitive skin." },
    createdAt: yesterday,
  });
  assert.equal(written, true);

  const shops = await getPastShops({ userId });
  assert.equal(
    shops.some((shop) => shop.projectId === strangerProjectId),
    false,
    "OWNS was traversed from the wrong user",
  );

  // Same words, same day, same theme — and still not recalled, because concepts
  // are keyed per user. This is the graph half of the isolation; the Postgres
  // half is RLS on `versions`, which no script can reach from out here.
  const recalled = await recallProject({
    userId,
    prompt: "rebuild that organic skincare shop I made yesterday",
    now,
  });
  assert.notEqual(recalled?.projectId, strangerProjectId, "recall crossed an account boundary");
});

await check("a user who has built nothing gets an empty list, not everyone's", async () => {
  assert.deepEqual(await getPastShops({ userId: randomUUID() }), []);
});

await check("the recalled shop's components are readable from a brand-new session", async () => {
  // This is the sequence the create turn runs: recall names the shop, the shop
  // is found among the user's past work, and its component list is what the
  // model reads before choosing which files to open.
  const recalled = await recallProject({
    userId,
    prompt: "create a website same as the organic skincare one from yesterday, same UI, name it Apple",
    now,
  });
  assert.equal(recalled?.projectId, skincareProjectId, "the shop to copy was not resolved");

  const shops = await getPastShops({ userId });
  const target = shops.find((shop) => shop.projectId === recalled.projectId);
  assert.ok(target, "the recalled shop is not in the user's past work");

  const inventory = await getComponentInventory(recalled.projectId, "landing");
  assert.equal(inventory.length, Object.keys(landingFiles()).length);
  for (const name of ["Hero", "Navbar", "Footer"]) {
    assert.ok(
      inventory.some((entry) => entry.path === `components/${name}.tsx`),
      `${name} is not reachable from the recalled project id`,
    );
  }
  assert.equal(
    inventory.some((entry) => entry.name.length === 0),
    false,
    "a component came back without the metadata the model picks files by",
  );
});

/* ──────────────────────────────── cleanup ─────────────────────────────── */

process.stdout.write("\ncleanup\n");

await check("every node this run wrote is removed", async () => {
  for (const label of Object.values(LABEL)) {
    // Concepts are keyed on the user, and every other node carries a per-run
    // uuid, so nothing here can reach a real project's data.
    const scoped =
      label === LABEL.concept || label === LABEL.theme
        ? null
        : { project_id: skincareProjectId };

    if (scoped) {
      for (const project_id of [skincareProjectId, candleProjectId, strangerProjectId]) {
        await hydraQuery(`MATCH (n:${label} {project_id: $project_id}) DETACH DELETE n`, {
          project_id,
        });
      }
    }
  }

  // Users, sessions, generations and concepts are addressed by their node ids.
  const { graphId, nodeKey } = await import("@/lib/hydra/ids");
  const { extractConcepts } = await import("@/lib/hydra/concepts");

  const concepts = extractConcepts(
    "organic skincare brand cold-pressed serums rosehip repair candle studio hand-poured soy candles Verdant Ember Oak sensitive skin someone else shop",
  );

  const ids = [
    graphId(nodeKey.user(userId)),
    graphId(nodeKey.user(strangerId)),
    graphId(nodeKey.project(skincareProjectId)),
    graphId(nodeKey.project(candleProjectId)),
    graphId(nodeKey.project(strangerProjectId)),
    graphId(nodeKey.session(sessionOne)),
    graphId(nodeKey.session(sessionTwo)),
    graphId(nodeKey.generation(landingVersionId)),
    graphId(nodeKey.generation(productVersionId)),
    graphId(nodeKey.generation(candleVersionId)),
    graphId(nodeKey.generation(strangerVersionId)),
    ...concepts.flatMap((concept) => [
      graphId(nodeKey.concept(userId, concept.key)),
      graphId(nodeKey.concept(strangerId, concept.key)),
    ]),
  ];

  for (const id of ids) {
    await hydraQuery("MATCH (n {id: $id}) DETACH DELETE n", { id });
  }

  const leftover = await hydraQuery(
    `MATCH (g:${LABEL.generation} {version_id: $version}) RETURN g.id AS id`,
    { version: landingVersionId },
  );
  assert.equal(leftover?.length ?? 0, 0, "the run left generations behind");

  assert.deepEqual(await getSessionHistory(sessionOne), [], "the run left a session behind");
  assert.deepEqual(await getPastShops({ userId }), [], "the run left a project behind");
  assert.deepEqual(await getPastShops({ userId: strangerId }), [], "the run left an account behind");
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
