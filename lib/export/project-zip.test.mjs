import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * Offline test for the export tree builder. No zip, no jszip, no browser: the
 * blob path is a thin wrapper over JSZip, while everything worth asserting —
 * what lands in the tree, what never gets overwritten, what gets thrown away —
 * is in `buildExportFileTree`, which is why that function exists separately.
 *
 * Run it with:
 *   node lib/export/project-zip.test.mjs
 *
 * `register` reuses the AI tests' alias hook, which teaches Node the project's
 * `@/*` alias; Node itself strips the types out of the .ts source.
 */

register("../ai/alias-hooks.mjs", import.meta.url);

const { buildExportFileTree, exportFileName, exportProjectSlug } = await import("./project-zip.ts");
const { LANDING_REQUIRED_FILES, PAGE_ROUTES } = await import("@/lib/framework");
const { THEME_FILE_NAME } = await import("@/lib/types");

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
    const detail = error.message.slice(0, 600).split("\n").join("\n       ");
    process.stdout.write(`  FAIL ${label}\n       ${detail}\n`);
  }
}

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const THEME = {
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

const COMPONENT_NAMES = ["Navbar", "Hero", "Features", "Testimonials", "CTA", "Footer"];

function componentSource(name) {
  const clientDirective = name === "Testimonials" ? '"use client";\n\n' : "";
  return `${clientDirective}export default function ${name}() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h2 className="text-3xl font-semibold text-[#14181C]">${name}</h2>
      <img
        alt="${name} illustration"
        className="mt-6 w-full object-cover"
        height={600}
        src="https://picsum.photos/seed/${name.toLowerCase()}/1200/600"
        width={1200}
      />
    </section>
  );
}
`;
}

function landingFiles() {
  const files = {
    "app/page.tsx": `${COMPONENT_NAMES.map((name) => `import ${name} from "@/components/${name}";`).join("\n")}

export default function Page() {
  return (
    <main className="min-h-screen bg-[#FFFFFF]">
${COMPONENT_NAMES.map((name) => `      <${name} />`).join("\n")}
    </main>
  );
}
`,
  };
  for (const name of COMPONENT_NAMES) files[`components/${name}.tsx`] = chromeOr(name, "/");
  return files;
}

/** Chrome for the route, or a plain section for everything else. */
function chromeOr(name, route) {
  if (name === "Navbar") return navbarSource(route);
  if (name === "Footer") return FOOTER_SOURCE;
  return componentSource(name);
}

/**
 * Chrome as the model now writes it: the product turn edits the landing page's
 * file, so the two copies differ only in which link is the current route.
 */
function navbarSource(currentRoute) {
  const link = (href, label) => {
    const current = href === currentRoute;
    return `        <a
          className="${current ? "font-semibold text-[#14181C] underline" : "text-[#6B7280]"}"
          href="${href}"${current ? '\n          aria-current="page"' : ""}
        >
          ${label}
        </a>`;
  };

  return `export default function Navbar() {
  return (
    <header className="sticky top-0 border-b border-[#E5E1D8]">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4">
        <a className="mr-auto text-base font-semibold" href="/">
          Morning Ritual
        </a>
${link("/", "Home")}
${link("/product", "Shop")}
        <button aria-label="Cart" type="button">
          Cart (0)
        </button>
      </nav>
    </header>
  );
}
`;
}

/** The footer carries both routes but marks neither, so it is byte-identical. */
const FOOTER_SOURCE = `export default function Footer() {
  return (
    <footer className="border-t border-[#E5E1D8] px-4 py-14">
      <p className="font-medium">Shop</p>
      <ul>
        <li>
          <a href="/">Home</a>
        </li>
        <li>
          <a href="/product">Shop</a>
        </li>
      </ul>
    </footer>
  );
}
`;

const PRODUCT_COMPONENT_NAMES = ["Navbar", "Gallery", "Details", "Reviews", "Footer"];

function productFiles() {
  const files = {
    "app/page.tsx": `${PRODUCT_COMPONENT_NAMES.map((name) => `import ${name} from "@/components/${name}";`).join("\n")}

export default function Page() {
  return (
    <main className="min-h-screen bg-[#FFFFFF]">
${PRODUCT_COMPONENT_NAMES.map((name) => `      <${name} />`).join("\n")}
    </main>
  );
}
`,
  };
  for (const name of PRODUCT_COMPONENT_NAMES) {
    files[`components/${name}.tsx`] = chromeOr(name, PAGE_ROUTES.product);
  }
  return files;
}

/**
 * A shop from before the shared-chrome contract: its product page was written
 * on its own, so its navbar and footer are different components rather than the
 * same one marked for a different route.
 */
function legacyProductFiles() {
  const files = productFiles();
  files["components/Navbar.tsx"] = componentSource("Navbar");
  files["components/Footer.tsx"] = componentSource("Footer");
  return files;
}

const INPUT = {
  files: landingFiles(),
  theme: THEME,
  pageType: "landing",
  name: "Morning Ritual",
  summary: "Slow-brew coffee kits for people who wake up early on purpose.",
  prompt: "A landing page for a slow-brew coffee kit brand called Morning Ritual.",
};

const BOTH_PAGES = {
  pages: { landing: landingFiles(), product: productFiles() },
  theme: THEME,
  name: "Morning Ritual",
  summary: "Slow-brew coffee kits for people who wake up early on purpose.",
  prompt: "A landing page for a slow-brew coffee kit brand called Morning Ritual.",
};

const SCAFFOLD_PATHS = [
  ".gitignore",
  "README.md",
  "app/globals.css",
  "app/layout.tsx",
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "postcss.config.mjs",
  THEME_FILE_NAME,
  "tsconfig.json",
];

/* ───────────────────────────────── tests ──────────────────────────────── */

process.stdout.write("\nbuildExportFileTree\n");

check("every required landing file survives byte-identical", () => {
  const tree = buildExportFileTree(INPUT);
  for (const path of LANDING_REQUIRED_FILES) {
    assert.equal(tree[path], INPUT.files[path], `${path} was altered or dropped`);
  }
});

check("the scaffold is complete", () => {
  const tree = buildExportFileTree(INPUT);
  for (const path of SCAFFOLD_PATHS) {
    assert.equal(typeof tree[path], "string", `${path} missing from the export`);
    assert.ok(tree[path].length > 0, `${path} is empty`);
  }
});

check("the scaffold is a Tailwind v4 project, not a v3 one", () => {
  const tree = buildExportFileTree(INPUT);
  assert.match(tree["app/globals.css"], /@import "tailwindcss";/);
  assert.doesNotMatch(tree["app/globals.css"], /@tailwind\s+(base|components|utilities)/);
  assert.equal(Object.keys(tree).some((path) => path.startsWith("tailwind.config.")), false);
  assert.match(tree["postcss.config.mjs"], /"@tailwindcss\/postcss": \{\}/);
});

check("package.json names, pins and scripts the project", () => {
  const manifest = JSON.parse(buildExportFileTree(INPUT)["package.json"]);
  assert.equal(manifest.name, "morning-ritual");
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.scripts).sort(), ["build", "dev", "start"]);
  for (const dependency of ["next", "react", "react-dom"]) {
    assert.match(manifest.dependencies[dependency], /^\^\d+\./, `${dependency} is not pinned`);
  }
  for (const dependency of [
    "@tailwindcss/postcss",
    "@types/node",
    "@types/react",
    "@types/react-dom",
    "tailwindcss",
    "typescript",
  ]) {
    assert.match(manifest.devDependencies[dependency], /^\^\d+\./, `${dependency} is not pinned`);
  }
});

check("tsconfig carries the @/* alias the generated imports need", () => {
  const tsconfig = JSON.parse(buildExportFileTree(INPUT)["tsconfig.json"]);
  assert.deepEqual(tsconfig.compilerOptions.paths, { "@/*": ["./*"] });
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.deepEqual(tsconfig.compilerOptions.plugins, [{ name: "next" }]);
  assert.deepEqual(tsconfig.include, [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
  ]);
});

check("next.config whitelists picsum for next/image", () => {
  assert.match(buildExportFileTree(INPUT)["next.config.ts"], /hostname: "picsum\.photos"/);
});

check("next.config whitelists the bucket an uploaded photo came from", () => {
  const hero = `export default function Hero() {
  return <img alt="Bottle" height={900} src="https://abcxyz.supabase.co/storage/v1/object/public/shop-assets/u/p/one.webp" width={1600} />;
}
`;
  const config = buildExportFileTree({
    ...INPUT,
    files: { ...INPUT.files, "components/Hero.tsx": hero },
  })["next.config.ts"];

  assert.match(config, /hostname: "abcxyz\.supabase\.co"/);
  assert.match(config, /hostname: "picsum\.photos"/);
});

check("an uploaded photo is called out in the README, with its risk", () => {
  const hero = `export default function Hero() {
  return <img alt="Bottle" height={900} src="https://abcxyz.supabase.co/storage/v1/object/public/shop-assets/u/p/one.webp" width={1600} />;
}
`;
  const readme = buildExportFileTree({
    ...INPUT,
    files: { ...INPUT.files, "components/Hero.tsx": hero },
  })["README.md"];

  assert.match(readme, /abcxyz\.supabase\.co/);
  assert.match(readme, /disappear if you delete that bucket/);
});

check("a shop with no uploads keeps the plain placeholder note", () => {
  const readme = buildExportFileTree(INPUT)["README.md"];
  assert.match(readme, /Every image points at/);
  assert.doesNotMatch(readme, /supabase/i);
});

check("a generated file is never overwritten by the scaffold", () => {
  const layout = "// hand-written by the model\nexport default function RootLayout() {}\n";
  const theme = '{"colors":{"primary":"#000000"}}\n';
  const tree = buildExportFileTree({
    ...INPUT,
    files: { ...INPUT.files, "app/layout.tsx": layout, [THEME_FILE_NAME]: theme },
  });
  assert.equal(tree["app/layout.tsx"], layout);
  assert.equal(tree[THEME_FILE_NAME], theme);
});

check("a page is synthesised when the generation produced none", () => {
  const tree = buildExportFileTree({ ...INPUT, files: { "components/Hero.tsx": "export default function Hero() {}\n" } });
  assert.match(tree["app/page.tsx"], /export default function Page\(\)/);
  assert.match(tree["app/page.tsx"], /Morning Ritual/);
});

check("hostile paths are dropped", () => {
  const hostile = {
    "../../../etc/passwd": "root:x:0:0",
    "../escape.tsx": "export default function Escape() {}",
    "/etc/hosts": "127.0.0.1 localhost",
    "/app/page.tsx": "absolute paths are not project-relative",
    "node_modules/evil/index.js": "require('child_process')",
    "components/node_modules/evil.tsx": "nope",
    "C:/Windows/system32/drivers/etc/hosts": "nope",
    "components/Ok.tsx": "export default function Ok() {}\n",
  };
  const tree = buildExportFileTree({ ...INPUT, files: { ...INPUT.files, ...hostile } });

  for (const path of Object.keys(tree)) {
    assert.equal(path.startsWith("/"), false, `${path} is absolute`);
    assert.equal(path.includes(".."), false, `${path} traverses upwards`);
    assert.equal(path.includes("node_modules"), false, `${path} reaches into node_modules`);
    assert.equal(path.includes(":"), false, `${path} carries a drive letter`);
  }
  assert.equal(tree["etc/passwd"], undefined, "a traversal was re-rooted instead of dropped");
  assert.equal(tree["escape.tsx"], undefined, "a traversal was re-rooted instead of dropped");
  assert.equal(tree["etc/hosts"], undefined, "an absolute path was re-rooted instead of dropped");
  assert.equal(tree["app/page.tsx"], INPUT.files["app/page.tsx"], "the real page was clobbered");
  assert.equal(tree["components/Ok.tsx"], "export default function Ok() {}\n");
});

check("non-string entries are ignored rather than serialised", () => {
  const tree = buildExportFileTree({
    ...INPUT,
    files: { ...INPUT.files, "components/Broken.tsx": null, "components/Missing.tsx": undefined },
  });
  assert.equal("components/Broken.tsx" in tree, false);
  assert.equal("components/Missing.tsx" in tree, false);
});

check("output is deterministic and sorted", () => {
  const first = buildExportFileTree(INPUT);
  const second = buildExportFileTree(INPUT);
  assert.deepEqual(Object.keys(first), Object.keys(second));
  assert.deepEqual(Object.keys(first), [...Object.keys(first)].sort());
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  // Key insertion order in the input must not leak into the output.
  const shuffled = Object.fromEntries(Object.entries(INPUT.files).reverse());
  assert.equal(JSON.stringify(buildExportFileTree({ ...INPUT, files: shuffled })), JSON.stringify(first));
});

check("a hostile theme cannot escape the CSS or the layout", () => {
  const tree = buildExportFileTree({
    ...INPUT,
    files: INPUT.files,
    theme: {
      colors: { primary: "red; } html { display: none", background: "url(javascript:alert(1))" },
      fonts: { heading: 'Evil"><script>', body: "Inter'; }" },
      radius: "1rem; } * { display: none",
    },
  });

  const css = tree["app/globals.css"];
  const layout = tree["app/layout.tsx"];

  for (const needle of ["display: none", "<script>", "javascript:", "alert(1)"]) {
    assert.equal(css.includes(needle), false, `${needle} reached globals.css`);
    assert.equal(layout.includes(needle), false, `${needle} reached the layout`);
  }
  // The fallbacks stand in for every rejected value.
  assert.match(css, /--color-primary: #111111;/);
  assert.match(css, /--radius: 0\.5rem;/);
  assert.match(layout, /family=Inter/);
  assert.equal(layout.includes("Evil"), false, "the hostile family name survived into the layout");
});

check("a hostile name cannot escape the manifest or the file name", () => {
  const hostile = '../../etc/"; rm -rf /';
  const tree = buildExportFileTree({ ...INPUT, name: hostile });
  const manifest = JSON.parse(tree["package.json"]);
  assert.match(manifest.name, /^[a-z0-9][a-z0-9-]*$/);
  assert.match(exportFileName(hostile), /^[a-z0-9][a-z0-9-]*\.zip$/);
});

check("the README records the prompt and the run instructions", () => {
  const readme = buildExportFileTree(INPUT)["README.md"];
  assert.match(readme, /^# Morning Ritual$/m);
  assert.match(readme, /npm install/);
  assert.match(readme, /npm run dev/);
  assert.match(readme, /> A landing page for a slow-brew coffee kit brand/);
  assert.match(readme, /picsum\.photos/);
});

process.stdout.write("\nbuildExportFileTree — both pages in one app\n");

check("the landing page keeps the root route and the product page gets its own", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  assert.equal(tree["app/page.tsx"], BOTH_PAGES.pages.landing["app/page.tsx"]);
  assert.equal(typeof tree["app/product/page.tsx"], "string");
  assert.match(tree["app/product/page.tsx"], /import Gallery from/);
});

check("neither page's sections can overwrite the other's", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  for (const name of ["Hero", "Features", "Testimonials", "CTA"]) {
    assert.equal(typeof tree[`components/${name}.tsx`], "string", `${name} was lost`);
  }
  for (const name of ["Gallery", "Details", "Reviews"]) {
    assert.equal(typeof tree[`components/product/${name}.tsx`], "string", `${name} was lost`);
  }
});

check("the relocated page's imports point at its own sections", () => {
  const page = buildExportFileTree(BOTH_PAGES)["app/product/page.tsx"];
  for (const name of ["Gallery", "Details", "Reviews"]) {
    assert.match(
      page,
      new RegExp(`from "@/components/product/${name}"`),
      `${name} still resolves to the landing page's copy`,
    );
  }
  // Only the shared chrome is allowed to resolve outside this page's folder.
  const rooted = [...page.matchAll(/from "@\/components\/([A-Z][\w$]*)"/g)].map((match) => match[1]);
  assert.deepEqual(rooted.sort(), ["Footer", "Navbar"]);
});

check("the two pages share one theme and one layout", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  assert.equal(Object.keys(tree).filter((path) => path.endsWith("layout.tsx")).length, 1);
  assert.equal(Object.keys(tree).filter((path) => path.endsWith(THEME_FILE_NAME)).length, 1);
  assert.match(tree["app/globals.css"], /--color-primary: #1B4332;/i);
});

check("the README documents both routes", () => {
  const readme = buildExportFileTree(BOTH_PAGES)["README.md"];
  assert.match(readme, /## Routes/);
  assert.match(readme, /\| `\/` \| Landing page \|/);
  assert.match(readme, /\| `\/product` \| Product page \|/);
});

check("a lone product page still owns the root route", () => {
  const tree = buildExportFileTree({ ...BOTH_PAGES, pages: { product: productFiles() } });
  assert.equal(tree["app/page.tsx"], productFiles()["app/page.tsx"]);
  assert.equal("app/product/page.tsx" in tree, false);
  assert.doesNotMatch(tree["README.md"], /## Routes/);
});

check("a single-page export is unaffected by the merge path", () => {
  const viaFiles = buildExportFileTree(INPUT);
  const viaPages = buildExportFileTree({ ...INPUT, files: undefined, pages: { landing: landingFiles() } });
  assert.equal(JSON.stringify(viaFiles), JSON.stringify(viaPages));
});

check("merged output stays deterministic", () => {
  const first = buildExportFileTree(BOTH_PAGES);
  const second = buildExportFileTree(BOTH_PAGES);
  assert.deepEqual(Object.keys(first), [...Object.keys(first)].sort());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

process.stdout.write("\nbuildExportFileTree — one copy of the chrome\n");

check("a footer both pages agree on is written once", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  assert.equal(tree["components/Footer.tsx"], FOOTER_SOURCE, "the shared footer was altered");
  assert.equal(
    "components/product/Footer.tsx" in tree,
    false,
    "the footer is still duplicated into the product folder",
  );
});

check("a navbar that differs only by route becomes one route-aware component", () => {
  const navbar = buildExportFileTree(BOTH_PAGES)["components/Navbar.tsx"];

  assert.equal("components/product/Navbar.tsx" in buildExportFileTree(BOTH_PAGES), false);
  // Neither route may be hard-coded as the current one.
  assert.doesNotMatch(navbar, /aria-current="page"/);
  assert.match(navbar, /^"use client";/);
  assert.match(navbar, /import \{ usePathname \} from "next\/navigation";/);
  assert.match(navbar, /export default function Navbar\(\) \{\n {2}const pathname = usePathname\(\);/);

  for (const route of [PAGE_ROUTES.landing, PAGE_ROUTES.product]) {
    const condition = `pathname === ${JSON.stringify(route)}`;
    assert.ok(
      navbar.includes(`aria-current={${condition} ? "page" : undefined}`),
      `${route} never becomes the current route`,
    );
    assert.ok(
      navbar.includes(`className={${condition} ?`),
      `${route}'s link has no active styling to switch to`,
    );
  }
});

check("the merged navbar keeps everything both copies agreed on", () => {
  const navbar = buildExportFileTree(BOTH_PAGES)["components/Navbar.tsx"];

  // The wordmark also points at "/", but both copies wrote it the same way, so
  // it stays a plain link rather than being marked current on the home route.
  assert.match(navbar, /<a className="mr-auto text-base font-semibold" href="\/">/);
  assert.match(navbar, /<button aria-label="Cart" type="button">/);
  for (const fragment of ['href="/"', 'href="/product"', "Morning Ritual", "Home", "Shop"]) {
    assert.ok(navbar.includes(fragment), `${fragment} was lost in the merge`);
  }
  // Both routes' styles have to survive, not just the one that was kept.
  assert.ok(navbar.includes('"font-semibold text-[#14181C] underline"'));
  assert.ok(navbar.includes('"text-[#6B7280]"'));
});

check("both routes import the one copy", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  for (const entry of ["app/page.tsx", "app/product/page.tsx"]) {
    for (const name of ["Navbar", "Footer"]) {
      assert.match(
        tree[entry],
        new RegExp(`from "@/components/${name}"`),
        `${entry} does not import the shared ${name}`,
      );
    }
  }
});

check("chrome that genuinely differs is de-conflicted, not merged away", () => {
  const product = legacyProductFiles();
  const tree = buildExportFileTree({ ...BOTH_PAGES, pages: { landing: landingFiles(), product } });

  // Nothing may be silently dropped: an older project has two real navbars.
  assert.equal(tree["components/Navbar.tsx"], navbarSource(PAGE_ROUTES.landing));
  assert.equal(tree["components/product/Navbar.tsx"], product["components/Navbar.tsx"]);
  assert.equal(tree["components/product/Footer.tsx"], product["components/Footer.tsx"]);
  assert.match(tree["app/product/page.tsx"], /from "@\/components\/product\/Navbar"/);
  assert.doesNotMatch(tree["components/Navbar.tsx"], /usePathname/);
});

check("a chrome file only one page has is left where it is", () => {
  const landing = landingFiles();
  const product = productFiles();
  delete product["components/Footer.tsx"];

  const tree = buildExportFileTree({ ...BOTH_PAGES, pages: { landing, product } });
  assert.equal(tree["components/Footer.tsx"], FOOTER_SOURCE);
  assert.equal("components/product/Footer.tsx" in tree, false);
});

check("chrome a sibling imports relatively is never hoisted", () => {
  // Sharing would leave "./Navbar" pointing at a file no longer in the folder.
  const product = productFiles();
  product["components/Gallery.tsx"] = `import Navbar from "./Navbar";\n\n${componentSource("Gallery")}`;

  const tree = buildExportFileTree({ ...BOTH_PAGES, pages: { landing: landingFiles(), product } });
  assert.equal(typeof tree["components/product/Navbar.tsx"], "string");
  assert.match(tree["components/product/Gallery.tsx"], /from "\.\/Navbar"/);
});

check("the README says the chrome is shared, and only when it is", () => {
  assert.match(buildExportFileTree(BOTH_PAGES)["README.md"], /chrome is shared rather than duplicated/);

  const legacy = buildExportFileTree({
    ...BOTH_PAGES,
    pages: { landing: landingFiles(), product: legacyProductFiles() },
  });
  assert.doesNotMatch(legacy["README.md"], /chrome is shared/);
});

process.stdout.write("\nbuildExportFileTree — one shop, two routes\n");

check("the route the prompts link to is the route the export mounts", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  assert.equal(PAGE_ROUTES.landing, "/");
  assert.ok(
    `app${PAGE_ROUTES.product}/page.tsx` in tree,
    `nothing serves ${PAGE_ROUTES.product}, which is what the prompts tell the model to link to`,
  );
});

check("cross-page hrefs survive the relocation byte for byte", () => {
  // relocate() rewrites `@/components/*` specifiers. An href is not a specifier
  // and must come out untouched, or every link between the pages breaks.
  const cta = 'export default function CTA() {\n  return <a href="/product">Shop the range</a>;\n}\n';
  const navbar = 'export default function Navbar() {\n  return <a href="/">Morning Ritual</a>;\n}\n';

  const tree = buildExportFileTree({
    ...BOTH_PAGES,
    pages: {
      landing: { ...landingFiles(), "components/CTA.tsx": cta },
      product: { ...productFiles(), "components/Navbar.tsx": navbar },
    },
  });

  assert.equal(tree["components/CTA.tsx"], cta);
  assert.equal(tree["components/product/Navbar.tsx"], navbar);
});

check("a landing page with no product page still exports a live /product route", () => {
  const tree = buildExportFileTree({ ...BOTH_PAGES, pages: { landing: landingFiles() } });
  const holding = tree["app/product/page.tsx"];

  assert.equal(typeof holding, "string", "the route every landing CTA points at would 404");
  assert.match(holding, /export default function Page\(\)/);
  assert.match(holding, /href="\/"/, "the holding page has no way back to the shop");
  assert.match(tree["README.md"], /## Routes/);
  assert.match(tree["README.md"], /not built yet/);
});

check("a real product page is never replaced by the holding route", () => {
  const tree = buildExportFileTree(BOTH_PAGES);
  assert.match(tree["app/product/page.tsx"], /import Gallery from/);
  assert.doesNotMatch(tree["app/product/page.tsx"], /has not been built yet/);
});

check("a shop with no landing page gets no holding route", () => {
  const tree = buildExportFileTree({ ...BOTH_PAGES, pages: { product: productFiles() } });
  assert.equal("app/product/page.tsx" in tree, false);
  assert.equal("app/home/page.tsx" in tree, false);
});

check("a hostile shop name cannot escape the holding route's JSX", () => {
  const tree = buildExportFileTree({
    ...BOTH_PAGES,
    pages: { landing: landingFiles() },
    name: 'Evil</p><script>alert(1)</script> {process.env.SECRET}',
  });
  const holding = tree["app/product/page.tsx"];

  // The name lands in JSX children, so a tag or an expression container in it
  // would become markup or run. Both are neutralised to spaces.
  for (const needle of ["<script", "</script", "{process"]) {
    assert.equal(holding.includes(needle), false, `${needle} reached the holding route`);
  }
  assert.match(holding, /Evil \/p script alert\(1\) \/script process\.env\.SECRET/);
});

process.stdout.write("\nexportFileName\n");

check("slugifies and never returns an empty or unsafe name", () => {
  const cases = [
    ["Morning Ritual", "morning-ritual.zip"],
    ["  Ember & Oak  ", "ember-oak.zip"],
    ["Café Über", "cafe-uber.zip"],
    ["../../etc/passwd", "etc-passwd.zip"],
    ["!!!", "dropshipping-site.zip"],
    ["", "dropshipping-site.zip"],
    [undefined, "dropshipping-site.zip"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(exportFileName(input), expected, `exportFileName(${JSON.stringify(input)})`);
  }
});

check("the slug is a legal npm package name", () => {
  for (const input of ["Morning Ritual", "9 Lives", "_private", ".hidden", "A".repeat(300)]) {
    const slug = exportProjectSlug(input);
    assert.ok(slug.length > 0 && slug.length <= 214, `${slug} is not a usable length`);
    assert.match(slug, /^[a-z0-9][a-z0-9._-]*$/, `${slug} is not a legal npm name`);
    assert.equal(slug, slug.toLowerCase());
  }
});

/* ──────────────────────────────── summary ─────────────────────────────── */

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
if (failures > 0) process.exitCode = 1;
