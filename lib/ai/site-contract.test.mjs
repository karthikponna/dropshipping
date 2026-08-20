import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test for the one-site contract: the part of the prompt that makes two
 * independently generated pages come out as two routes of the same shop.
 *
 * There is nothing downstream that can enforce this — each page type is written
 * in its own turn, into its own tree, and the trees are never merged until
 * export. The only mechanism is the brief, so these checks pin the brief: the
 * hrefs the model is told to write are the routes the export mounts, the chrome
 * rules reach both page types, and neither page type is told to link somewhere
 * that does not exist.
 *
 * Run it with:
 *   node lib/ai/site-contract.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const { buildSystemPrompt, buildCreateMessage } = await import("./prompts/index.ts");
const {
  PAGE_ROUTES,
  PAGE_ROUTE_SEGMENTS,
  SITE_ROUTES,
  getFramework,
  pageTypeForHref,
  renderSiteChromeBrief,
} = await import("@/lib/framework");
const { PAGE_TYPES } = await import("@/lib/types");

let checks = 0;
let failures = 0;

function check(label, fn) {
  checks += 1;
  try {
    fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    const detail = error.message.slice(0, 600).split("\n").join("\n       ");
    process.stdout.write(`  FAIL ${label}\n       ${detail}\n`);
  }
}

/** Every href the brief or a manifest tells the model to write. */
function hrefsIn(text) {
  return [...text.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

function manifestText(pageType) {
  const framework = getFramework(pageType);
  return [
    ...framework.promptGuidance,
    ...framework.components.flatMap((component) => [
      component.purpose,
      ...component.requirements,
    ]),
  ].join("\n");
}

process.stdout.write("\nthe route map\n");

check("the two routes are distinct, rooted, and the landing page owns /", () => {
  assert.equal(PAGE_ROUTES.landing, "/");
  assert.equal(new Set(Object.values(PAGE_ROUTES)).size, PAGE_TYPES.length);
  for (const path of Object.values(PAGE_ROUTES)) {
    assert.match(path, /^\/[a-z-]*$/, `${path} is not a simple rooted path`);
  }
  assert.deepEqual(
    SITE_ROUTES.map((route) => route.pageType),
    [...PAGE_TYPES],
  );
});

check("a secondary page's segment is the tail of its route", () => {
  for (const pageType of PAGE_TYPES) {
    if (PAGE_ROUTES[pageType] === "/") continue;
    assert.equal(
      `/${PAGE_ROUTE_SEGMENTS[pageType]}`,
      PAGE_ROUTES[pageType],
      `${pageType} would be written at one path and mounted at another`,
    );
  }
});

check("only the shop's own routes resolve", () => {
  assert.equal(pageTypeForHref("/"), "landing");
  assert.equal(pageTypeForHref("/product"), "product");
  for (const href of ["#features", "", "/cart", "/product/2", "https://x.test/product", "//x.test"]) {
    assert.equal(pageTypeForHref(href), null, href);
  }
});

process.stdout.write("\nthe chrome contract\n");

check("both page types are told the whole route table, and which one they are", () => {
  for (const pageType of PAGE_TYPES) {
    const brief = renderSiteChromeBrief(pageType);
    for (const path of Object.values(PAGE_ROUTES)) {
      assert.ok(brief.includes(path), `${pageType}'s brief never mentions ${path}`);
    }
    assert.match(brief, /the page you are writing now/, `${pageType} is not told which route it is`);
    assert.ok(
      brief.includes(`current route (${PAGE_ROUTES[pageType]})`),
      `${pageType} is not told to mark its own nav link`,
    );
  }
});

check("the chrome rules cover the wordmark, both link sets and the geometry", () => {
  for (const pageType of PAGE_TYPES) {
    const brief = renderSiteChromeBrief(pageType);
    assert.match(brief, /wordmark is the shop name/);
    assert.match(brief, /aria-current="page"/);
    assert.match(brief, /The footer carries the wordmark/);
    assert.match(brief, /Chrome geometry is identical across routes/);
    // Fragments have to stay fragments, or in-page anchors become route changes.
    assert.match(brief, /href="#features"/);
  }
});

/*
 * The three slots the brief used to leave open. Each one came back filled
 * differently on the two turns — a "Shop now" button against a cart glyph, a
 * nav padded out with #features, footer columns invented per page — so the
 * contract now names them and these checks keep them named.
 */
check("the nav is only the route links, on both page types", () => {
  for (const pageType of PAGE_TYPES) {
    const brief = renderSiteChromeBrief(pageType);
    assert.match(brief, /one link per route and NOTHING ELSE/);
    assert.match(brief, /never goes in the chrome — not in the nav, not in the footer/);

    const manifest = manifestText(pageType);
    assert.match(manifest, /Exactly two nav links, in this order/);
    assert.match(manifest, /No section links/);
  }
});

check("the header's trailing slot is the same one control on both page types", () => {
  for (const pageType of PAGE_TYPES) {
    assert.match(
      renderSiteChromeBrief(pageType),
      /right-hand end of the header holds exactly one control, on every route: <button type="button" aria-label="Cart">/,
    );
    assert.match(
      manifestText(pageType),
      /A single <button type="button" aria-label="Cart"> at the right end/,
      `${pageType}'s manifest leaves the header's right end open`,
    );
  }
  // A cart that were an anchor would be read as a route change by the preview.
  assert.match(renderSiteChromeBrief("product"), /Only navigation is an anchor/);
});

check("the footer's columns are pinned, so neither turn invents its own", () => {
  for (const pageType of PAGE_TYPES) {
    const brief = renderSiteChromeBrief(pageType);
    assert.match(brief, /exactly two link columns — "Shop"/);
    assert.match(brief, /then "Support"/);

    const manifest = manifestText(pageType);
    assert.match(manifest, /A column headed "Shop" carrying href="\/" then href="\/product"/);
    assert.match(manifest, /A second column headed "Support"/);
  }
});

check("the two manifests describe the chrome in the same words", () => {
  // Divergent wording is what produced divergent chrome, so the shared lines
  // are compared literally rather than each being matched on its own.
  const shared = (pageType) =>
    getFramework(pageType)
      .components.filter((component) => component.name === "Navbar" || component.name === "Footer")
      .flatMap((component) => component.requirements)
      .filter((line) => !line.includes("aria-current") && !line.includes("section links"));

  assert.deepEqual(shared("landing"), shared("product"));
});

check("every href the brief hands the model is a real route or a fragment", () => {
  for (const pageType of PAGE_TYPES) {
    for (const href of hrefsIn(renderSiteChromeBrief(pageType))) {
      assert.ok(
        href.startsWith("#") || pageTypeForHref(href) !== null,
        `the ${pageType} brief tells the model to write href="${href}", which is not a route`,
      );
    }
  }
});

process.stdout.write("\ncross-page links in the system prompts\n");

check("the landing prompt sends every primary action to the product route", () => {
  const prompt = buildSystemPrompt("landing", "create");
  for (const line of [
    'The Hero\'s PRIMARY CTA is <a href="/product">.',
    'The closing CTA band\'s single action is <a href="/product">.',
  ]) {
    assert.ok(prompt.includes(line), `missing from the landing prompt: ${line}`);
  }
  // A CTA the model renders as a <button> looks right and goes nowhere: the
  // preview's click interceptor and a real browser both only follow anchors.
  assert.match(prompt, /A CTA rendered as <button>, or as a <div> with an onClick, is broken/);
  // The header used to carry a CTA of its own, which is why it was the one part
  // of the chrome the two page types never agreed on.
  assert.doesNotMatch(prompt, /Navbar's CTA/);
  assert.match(prompt, /The Navbar is shared chrome/);
});

check("the product prompt links back and keeps its purchase controls buttons", () => {
  const prompt = buildSystemPrompt("product", "create");
  assert.match(prompt, /Getting back to the rest of the shop/);
  assert.match(prompt, /ProductInfo opens with a breadcrumb/);
  assert.ok(prompt.includes('and its "Shop" link at /product is the current route'));
  assert.match(prompt, /Add to cart, Buy now, the quantity stepper and the variant chips are <button>/);
});

check("no page type is allowed to sell a subscription", () => {
  // These are product shops. A tiered pricing block is the single most common
  // way a model reaches for a SaaS template when it is asked for a landing page.
  const landing = getFramework("landing");
  assert.equal(
    landing.composition.includes("Pricing"),
    false,
    "the landing page still requires a Pricing component",
  );
  assert.equal(
    landing.requiredFiles.includes("components/Pricing.tsx"),
    false,
    "components/Pricing.tsx is still a required file",
  );
  for (const pageType of PAGE_TYPES) {
    assert.match(
      buildSystemPrompt(pageType, "create"),
      /No (?:subscription tiers|pricing tiers)/,
      `the ${pageType} prompt does not rule out pricing tiers`,
    );
  }
});

check("neither prompt nor manifest invents a route that does not exist", () => {
  for (const pageType of PAGE_TYPES) {
    const text = `${buildSystemPrompt(pageType, "create")}\n${manifestText(pageType)}`;
    for (const href of hrefsIn(text)) {
      assert.ok(
        href.startsWith("#") || pageTypeForHref(href) !== null,
        `the ${pageType} brief would produce a dead link: href="${href}"`,
      );
    }
  }
});

check("the manifests agree with the prompt about the chrome", () => {
  const landing = manifestText("landing");
  const product = manifestText("product");

  // Both navbars carry the same two route links, and both footers repeat them.
  for (const text of [landing, product]) {
    assert.ok(text.includes('href="/product"'), "a manifest never names the product route");
    assert.ok(text.includes('href="/"'), "a manifest never names the landing route");
    assert.match(text, /column headed "Shop"/);
  }
  // The current route is marked on whichever page it is.
  assert.match(landing, /Home at href="\/" \(aria-current="page" here\)/);
  assert.match(product, /Shop at href="\/product" \(aria-current="page" here\)/);
  // The cart is a control, not a link — it would otherwise be intercepted.
  for (const text of [landing, product]) {
    assert.match(text, /<button type="button" aria-label="Cart">/);
  }
});

check("the shared contract survives into the create message's file list", () => {
  for (const pageType of PAGE_TYPES) {
    const message = buildCreateMessage(pageType, "A candle studio for slow evenings.");
    for (const path of getFramework(pageType).requiredFiles) {
      assert.ok(message.includes(path), `${path} is not asked for on the ${pageType} turn`);
    }
    assert.ok(
      getFramework(pageType).requiredFiles.includes("components/Navbar.tsx"),
      `${pageType} has no Navbar to share`,
    );
    assert.ok(
      getFramework(pageType).requiredFiles.includes("components/Footer.tsx"),
      `${pageType} has no Footer to share`,
    );
  }
});

check("a refine turn still carries the contract, so chrome is not edited away", () => {
  for (const pageType of PAGE_TYPES) {
    const prompt = buildSystemPrompt(pageType, "refine");
    assert.match(prompt, /THIS PAGE IS ONE ROUTE OF A SHOP/);
    assert.match(prompt, /THIS TURN: REFINE/);
  }
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
