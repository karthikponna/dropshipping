/**
 * Adapter test script. No test runner, no dependencies — run it with:
 *
 *     node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON lib/preview/run-tests.mjs
 *
 * (`run-tests.mjs` registers a resolve hook so Node can load the TypeScript
 * sources and the `@/` path alias directly.)
 *
 * The point of these checks is totality: the adapter is called on every stream
 * tick, so for each fixture it must not throw, must always produce a mountable
 * entry point, and must never leave an import the sandbox cannot resolve.
 */

import assert from "node:assert/strict";

import type { FileMap } from "@/lib/types";
import { DEFAULT_THEME } from "@/lib/types";

import { brokenFixture, fixtures, landingFixture, midStreamFixture } from "./fixtures";
import { SANDPACK_ROOT, toSandpack } from "./toSandpack";
import type { SandpackProject } from "./toSandpack";

/* ─────────────────────────────── tiny runner ────────────────────────────── */

interface Outcome {
  name: string;
  passed: boolean;
  detail?: string;
}

const outcomes: Outcome[] = [];

function check(name: string, run: () => void): void {
  try {
    run();
    outcomes.push({ name, passed: true });
  } catch (error) {
    outcomes.push({
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ────────────────────────────── shared helpers ──────────────────────────── */

const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const ALLOWED_BARE_IMPORTS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

const FROM_IMPORT = /^([ \t]*)(?:import|export)\b[^'"`;]*?\bfrom[ \t\r\n]*(['"])([^'"\n]+)\2/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]+(['"])([^'"\n]+)\1/gm;

function codeFiles(project: SandpackProject): string[] {
  return Object.keys(project.files).filter((path) =>
    CODE_EXTENSIONS.some((extension) => path.endsWith(extension)),
  );
}

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(FROM_IMPORT)) found.push(match[3]);
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) found.push(match[2]);
  return found;
}

function resolveWithin(project: SandpackProject, fromPath: string, specifier: string): boolean {
  const directory = fromPath.slice(0, fromPath.lastIndexOf("/"));
  const segments: string[] = directory.split("/").filter(Boolean);

  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const target = `/${segments.join("/")}`;
  if (target in project.files) return true;
  return CODE_EXTENSIONS.some(
    (extension) =>
      `${target}${extension}` in project.files || `${target}/index${extension}` in project.files,
  );
}

function assertMountable(project: SandpackProject, label: string): void {
  assert.equal(project.template, "vite-react-ts", `${label}: template`);
  assert.ok(project.files[SANDPACK_ROOT], `${label}: missing ${SANDPACK_ROOT}`);
  assert.match(project.files[SANDPACK_ROOT], /export default function App/, `${label}: App shape`);
  assert.ok(project.files["/index.tsx"], `${label}: missing /index.tsx`);
  assert.ok(project.files["/index.html"], `${label}: missing /index.html`);
  assert.ok(project.files["/app/page.tsx"], `${label}: missing /app/page.tsx`);
  assert.ok(
    project.files["/app/page.tsx"].includes("export default"),
    `${label}: entry has no default export`,
  );
  assert.equal(project.entry, SANDPACK_ROOT, `${label}: entry`);
  assert.match(project.files["/index.html"], /cdn\.tailwindcss\.com/, `${label}: tailwind cdn`);
  assert.match(project.files["/index.html"], /tailwind\.config = \{/, `${label}: tailwind config`);
  assert.match(project.files["/index.html"], /fonts\.googleapis\.com/, `${label}: font links`);
  assert.match(
    project.files["/index.html"],
    /<script type="module" src="\/index\.tsx"><\/script>/,
    `${label}: html entry script`,
  );

  for (const [path, source] of Object.entries(project.files)) {
    assert.equal(typeof source, "string", `${label}: ${path} is not a string`);
    assert.ok(path.startsWith("/"), `${label}: ${path} is not rooted`);
    assert.ok(!path.includes("//"), `${label}: ${path} has an empty segment`);
    assert.ok(!path.includes(".."), `${label}: ${path} escapes the root`);
  }

  for (const path of codeFiles(project)) {
    const source = project.files[path];

    // The shim modules are hand-written, not transformed, and their doc comments
    // legitimately mention the Next specifiers they stand in for.
    if (!path.startsWith("/shims/")) {
      assert.doesNotMatch(source, /["']use (client|server)["']/, `${label}: directive in ${path}`);
      assert.doesNotMatch(source, /from\s+["']@\//, `${label}: alias left in ${path}`);
      assert.doesNotMatch(source, /from\s+["']next(\/|["'])/, `${label}: next import in ${path}`);
    }

    for (const specifier of specifiersOf(source)) {
      if (specifier.startsWith(".")) {
        assert.ok(
          resolveWithin(project, path, specifier),
          `${label}: ${path} imports "${specifier}" which is not in the project`,
        );
        continue;
      }
      assert.ok(
        ALLOWED_BARE_IMPORTS.includes(specifier),
        `${label}: ${path} imports unavailable package "${specifier}"`,
      );
    }
  }
}

/* ──────────────────────────────── the checks ────────────────────────────── */

for (const fixture of fixtures) {
  check(`${fixture.name}: adapts without throwing into a mountable project`, () => {
    const project = toSandpack({ files: fixture.files, title: "Morning Ritual" });
    assertMountable(project, fixture.name);
  });
}

check("degenerate inputs never throw", () => {
  const inputs: unknown[] = [
    undefined,
    {},
    { files: undefined },
    { files: null },
    { files: {} },
    { files: [] },
    { files: "not a map" },
    { files: { "app/page.tsx": undefined } },
    { files: { "app/page.tsx": 12 } },
    { files: landingFixture, theme: "nonsense" },
    { files: landingFixture, theme: { colors: null, fonts: 7 } },
    { files: landingFixture, title: "</script><script>alert(1)</script>" },
  ];

  for (const input of inputs) {
    const project = toSandpack(input as Parameters<typeof toSandpack>[0]);
    assertMountable(project, `degenerate ${String(JSON.stringify(input)).slice(0, 40)}`);
  }
});

check("an empty tree renders the placeholder page", () => {
  const project = toSandpack({ files: {} });
  assert.equal(project.isPlaceholder, true);
  assert.match(project.files["/app/page.tsx"], /Building your page/);
});

check("a broken entry falls back to the placeholder instead of shipping bad syntax", () => {
  const project = toSandpack({ files: brokenFixture });
  assert.equal(project.isPlaceholder, true);
  assert.doesNotMatch(project.files["/app/page.tsx"], /not typescript/);
  assert.ok(project.warnings.length > 0, "expected warnings for broken input");
});

check("mid-stream components are stubbed with skeletons, entry still renders", () => {
  const project = toSandpack({ files: midStreamFixture });
  assert.equal(project.isPlaceholder, false);
  assert.ok(project.files["/components/Navbar.tsx"], "complete component kept");
  // Hero arrived truncated; Features..Footer never arrived. All are stubbed.
  for (const name of ["Hero", "Features", "Pricing", "Testimonials", "CTA", "Footer"]) {
    const path = `/components/${name}.tsx`;
    assert.ok(project.files[path], `expected a stub for ${path}`);
    assert.match(project.files[path], /animate-pulse/, `${path} should be a skeleton`);
    assert.ok(project.stubbedPaths.includes(path), `${path} should be reported as stubbed`);
  }
});

check("next/image and next/link resolve to shim modules, not rewritten JSX", () => {
  const project = toSandpack({ files: landingFixture });
  const hero = project.files["/components/Hero.tsx"];
  assert.match(hero, /import Image from "\.\.\/shims\/next-image"/);
  assert.match(hero, /import Link from "\.\.\/shims\/next-link"/);
  // The call sites are untouched: props survive verbatim.
  assert.match(hero, /priority\n/);
  assert.match(hero, /sizes="\(max-width: 768px\) 100vw, 1200px"/);
  assert.ok(project.files["/shims/next-image.tsx"]);
  assert.ok(project.files["/shims/next-link.tsx"]);
  assert.match(project.files["/shims/next-image.tsx"], /objectFit: "cover"/);
});

check("next/font imports become a destructure of the font shim", () => {
  const project = toSandpack({ files: landingFixture });
  const hero = project.files["/components/Hero.tsx"];
  assert.match(hero, /import __nextFont0 from "\.\.\/shims\/next-font";/);
  assert.match(hero, /const \{ Playfair_Display \} = __nextFont0;/);
  assert.match(hero, /const display = Playfair_Display\(/);
});

check("next/navigation resolves and unknown packages are stubbed with their bindings", () => {
  const project = toSandpack({ files: productFixtureFiles() });
  const addToCart = project.files["/components/AddToCart.tsx"];
  assert.match(addToCart, /import \{ useState \} from "react"/);
  assert.match(addToCart, /from "\.\.\/shims\/next-navigation"/);
  assert.match(addToCart, /from "\.\.\/shims\/packages\/lucide-react"/);
  assert.match(addToCart, /from "\.\.\/shims\/packages\/clsx"/);

  const lucide = project.files["/shims/packages/lucide-react.tsx"];
  assert.match(lucide, /export const ShoppingCart = StubComponent;/);
  assert.match(lucide, /export const Check = StubComponent;/);
  assert.match(project.files["/shims/packages/clsx.tsx"], /export default stubHelper;/);
});

check("app/ files other than the page are left out of the preview", () => {
  const project = toSandpack({ files: productFixtureFiles() });
  assert.equal(project.files["/app/layout.tsx"], undefined);
  assert.ok(project.warnings.some((warning) => warning.includes("app/layout.tsx")));
});

check("theme.json drives the tailwind config when no theme is passed", () => {
  const project = toSandpack({ files: landingFixture });
  assert.match(project.files["/index.html"], /#C8A24A/);
  assert.match(project.files["/index.html"], /Playfair\+Display/);
  assert.match(project.files["/styles.css"], /--primary: #C8A24A;/);
});

check("an explicit theme wins over theme.json and unsafe values are dropped", () => {
  const project = toSandpack({
    files: landingFixture,
    theme: {
      colors: { primary: "red; } body { display: none }" },
      fonts: { heading: "Evil</style><script>x()</script>", body: "DM Sans" },
      radius: "9px",
    },
  });
  assert.doesNotMatch(project.files["/index.html"], /display: none/);
  assert.doesNotMatch(project.files["/index.html"], /<script>x\(\)/);
  assert.match(project.files["/index.html"], new RegExp(DEFAULT_THEME.colors.primary));
  assert.match(project.files["/styles.css"], /--radius: 9px;/);
});

check("the title is escaped into the document head", () => {
  const project = toSandpack({ files: landingFixture, title: '"><script>alert(1)</script>' });
  assert.doesNotMatch(project.files["/index.html"], /<script>alert/);
  assert.match(project.files["/index.html"], /&quot;&gt;&lt;script&gt;/);
});

check("fingerprints are stable for equal input and differ for changed input", () => {
  const first = toSandpack({ files: landingFixture, title: "Morning Ritual" });
  const second = toSandpack({ files: { ...landingFixture }, title: "Morning Ritual" });
  assert.equal(first.fingerprint, second.fingerprint);

  const changed = toSandpack({
    files: { ...landingFixture, "components/Footer.tsx": "export default function Footer() { return <footer>Changed</footer>; }" },
    title: "Morning Ritual",
  });
  assert.notEqual(first.fingerprint, changed.fingerprint);

  const retitled = toSandpack({ files: landingFixture, title: "Copper Kettle" });
  assert.notEqual(first.fingerprint, retitled.fingerprint);
});

check("streaming the landing fixture one file at a time never breaks", () => {
  const paths = Object.keys(landingFixture);
  const partial: FileMap = {};

  for (const path of paths) {
    const whole = landingFixture[path];
    // Three snapshots per file: a quarter written, half written, complete.
    for (const fraction of [0.25, 0.5, 1]) {
      partial[path] = whole.slice(0, Math.max(1, Math.floor(whole.length * fraction)));
      assertMountable(toSandpack({ files: { ...partial } }), `stream ${path} @ ${fraction}`);
    }
  }

  const final = toSandpack({ files: partial });
  assert.equal(final.isPlaceholder, false);
  assert.equal(final.stubbedPaths.length, 0);
});

function productFixtureFiles(): FileMap {
  // Imported lazily so the fixture module stays the single source of truth.
  return fixtures[1].files;
}

/* ───────────────────────────────── report ───────────────────────────────── */

const failures = outcomes.filter((outcome) => !outcome.passed);

console.log(`\ntoSandpack — ${outcomes.length - failures.length}/${outcomes.length} checks passed\n`);
for (const outcome of outcomes) {
  console.log(`  ${outcome.passed ? "PASS" : "FAIL"}  ${outcome.name}`);
  if (!outcome.passed) console.log(`        ${outcome.detail}`);
}
console.log("");

if (failures.length > 0) process.exitCode = 1;
