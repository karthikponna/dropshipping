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
const { LANDING_REQUIRED_FILES } = await import("@/lib/framework");
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

const COMPONENT_NAMES = ["Navbar", "Hero", "Features", "Pricing", "Testimonials", "CTA", "Footer"];

function componentSource(name) {
  const clientDirective = name === "Pricing" ? '"use client";\n\n' : "";
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
  for (const name of COMPONENT_NAMES) files[`components/${name}.tsx`] = componentSource(name);
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
