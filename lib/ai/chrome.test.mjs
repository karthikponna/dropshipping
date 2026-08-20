import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test of the shop-chrome path — the one that stops a shop's two pages
 * inventing two different footers.
 *
 * The site-chrome contract in the system prompt closes everything it can name.
 * What it cannot close is invented detail, and this is the mechanism that does:
 * the second page is handed the first page's actual Navbar and Footer and told
 * to emit them back. So what is worth pinning here is that the source really
 * reaches the prompt, that only the per-route difference is licensed, and that
 * the two paths cannot drift apart from the frameworks they depend on.
 *
 * Run it with:
 *   node lib/ai/chrome.test.mjs
 */

register("./alias-hooks.mjs", import.meta.url);

const { CHROME_PATHS, renderInheritedDesign } = await import("./prompts/memory.ts");
const { buildCreateMessage } = await import("./prompts/index.ts");
const { LANDING_REQUIRED_FILES, PRODUCT_REQUIRED_FILES, PAGE_ROUTES } = await import(
  "@/lib/framework"
);

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

const NAVBAR = `export default function Navbar() {
  return (
    <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
      <a href="/">Ember &amp; Oak</a>
      <a href="/" aria-current="page">Home</a>
      <a href="/product">Shop</a>
      <button type="button" aria-label="Cart">0</button>
    </nav>
  );
}
`;

const FOOTER = `export default function Footer() {
  return (
    <footer className="border-t border-[#E4D9C8] px-6 py-16">
      <p>hello@emberandoak.shop</p>
      <p>Free returns within 14 days.</p>
      <p>© 2026 Ember &amp; Oak</p>
    </footer>
  );
}
`;

const CHROME = [
  { path: "components/Navbar.tsx", contents: NAVBAR },
  { path: "components/Footer.tsx", contents: FOOTER },
];

function inherited(overrides = {}) {
  return {
    sourcePageType: "landing",
    theme: {
      colors: { primary: "#5B4632" },
      fonts: { heading: "Fraunces", body: "Inter" },
      radius: "0.25rem",
    },
    shopName: "Ember & Oak",
    summary: "Small-batch organic skincare.",
    sections: ["Navbar", "Hero", "Footer"],
    ...overrides,
  };
}

/* ──────────────────────────────── checks ──────────────────────────────── */

process.stdout.write("\nshop chrome reuse\n");

// The chrome paths are named here rather than read off the framework, so this
// is the check that notices if a framework ever renames one. A silent miss
// means both pages quietly go back to writing their own headers.
await check("both page types really do require the files this path reuses", async () => {
  for (const path of CHROME_PATHS) {
    assert.ok(LANDING_REQUIRED_FILES.includes(path), `the landing page must have ${path}`);
    assert.ok(PRODUCT_REQUIRED_FILES.includes(path), `the product page must have ${path}`);
  }
  assert.deepEqual([...CHROME_PATHS], ["components/Navbar.tsx", "components/Footer.tsx"]);
});

await check("the sibling page's chrome reaches the prompt as source", async () => {
  const block = renderInheritedDesign(inherited({ chrome: CHROME }));

  assert.match(block, /<file path="components\/Navbar\.tsx">/);
  assert.match(block, /<file path="components\/Footer\.tsx">/);
  assert.ok(block.includes("hello@emberandoak.shop"), "the invented address has to travel verbatim");
  assert.ok(block.includes("Free returns within 14 days."), "and so does the returns window");
});

await check("only the current-route marker is licensed to change", async () => {
  const block = renderInheritedDesign(inherited({ chrome: CHROME }));

  assert.match(block, /Emit these files back/);
  assert.match(block, /byte-for-byte, with exactly one change/);
  assert.ok(
    block.includes(`aria-current="page" belongs on the link to ${PAGE_ROUTES.product}`),
    "the product page is the one being written, so the marker moves to its route",
  );
  assert.match(block, /the contact address, the returns window/);
});

await check("the route the marker moves to follows the page being written", async () => {
  const forProduct = renderInheritedDesign(inherited({ chrome: CHROME }));
  const forLanding = renderInheritedDesign(
    inherited({ sourcePageType: "product", chrome: CHROME }),
  );

  assert.ok(forProduct.includes(`the link to ${PAGE_ROUTES.product}`));
  assert.ok(forLanding.includes(`the link to ${PAGE_ROUTES.landing}`));
});

await check("a project whose sibling could not be read still inherits the look", async () => {
  const block = renderInheritedDesign(inherited());

  assert.equal(block.includes("<file path="), false, "no source, no file blocks");
  assert.equal(block.includes("THE SHOP'S CHROME"), false);
  assert.match(block, /REUSE THIS THEME/, "the palette contract is unaffected");
  assert.match(block, /bg-\[#5B4632\]/);
  assert.match(
    block,
    /navigation wording, footer columns/,
    "with no source to quote, the weaker description of the chrome has to come back",
  );
});

await check("the chrome survives into the message the writing turn is sent", async () => {
  const message = buildCreateMessage("product", "a product page for the serum", {
    inherited: inherited({ chrome: CHROME }),
    recalled: null,
    contextPaths: null,
  });

  assert.ok(message.includes("hello@emberandoak.shop"));
  assert.match(message, /<file path="components\/Footer\.tsx">/);
  // The emission contract still has to come after it, or the model reads the
  // quoted files as the answer and stops.
  assert.ok(
    message.indexOf("THE SHOP'S CHROME") < message.indexOf("Start your reply with <meta>"),
    "the reference belongs above the instruction to write",
  );
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);

if (failures > 0) process.exitCode = 1;
