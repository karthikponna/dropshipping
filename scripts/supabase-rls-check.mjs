import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

/**
 * `readPastPageSource` against a real Postgres, under real sessions.
 *
 * Opt-in, and deliberately not part of `npm test`, which is offline. Run it:
 *
 *   npm run supabase:local:up
 *   npm run supabase:local:rls
 *   npm run supabase:local:down
 *
 * Why it exists: `read_past_files` is the only place a generation opens the
 * database for source code, and the project id it reads with comes from the
 * model. Everything else about that path is covered offline against a fake
 * reader. The ownership check cannot be — it only means anything against real
 * policies and real JWTs, so this is the one test that can tell you the
 * guarantee still holds after somebody edits the query.
 *
 * Why local rather than the hosted project: obtaining a session needs either a
 * confirmable email, a service-role key or the JWT secret, and the hosted
 * project has email confirmation on and hands out none of the three. It also
 * needs a database it is allowed to break — see the last group of checks.
 */

register("./rls-loader.mjs", import.meta.url);

const { readPastPageSource } = await import("@/lib/ai/past-project.ts");

/* ─────────────────────────────── preflight ─────────────────────────────── */

const START_HINT = [
  "No local Supabase stack is answering.",
  "",
  "This check does not run against the hosted project — it needs a database it",
  "can sign into and temporarily break. Start a local one first:",
  "",
  "  npm run supabase:local:up     (needs Docker; first run pulls a few images)",
  "  npm run supabase:local:rls",
  "  npm run supabase:local:down",
].join("\n");

function die(reason) {
  process.stderr.write(`\n${reason}\n\n${START_HINT}\n\n`);
  process.exit(1);
}

function localStack() {
  try {
    const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const status = JSON.parse(raw);
    return status.API_URL && status.ANON_KEY && status.SERVICE_ROLE_KEY ? status : null;
  } catch {
    return null;
  }
}

const status = localStack();
if (!status) die("`supabase status` reported no running stack.");

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = status;

// The policy break below goes in over psql rather than PostgREST, because
// nothing the API exposes can alter a policy.
const DB_CONTAINER = (() => {
  try {
    return execFileSync("docker", ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)[0];
  } catch {
    return undefined;
  }
})();

if (!DB_CONTAINER) die("The stack is reachable but its database container is not running.");

function sql(statement) {
  return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-c", statement], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/* ──────────────────────────────── fixtures ─────────────────────────────── */

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** A confirmed user with a live session, which only a local stack can hand out. */
async function signedInUser(label) {
  const email = `${label}-${randomUUID()}@dropshipping.test`;
  const password = randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: created.user.id, client };
}

const FILES_V1 = {
  "app/page.tsx": "export default function Page() {\n  return <main>v1</main>;\n}\n",
  "components/Hero.tsx": "export default function Hero() {\n  return <section>Verdant</section>;\n}\n",
};
const FILES_V2 = {
  ...FILES_V1,
  "app/page.tsx": "export default function Page() {\n  return <main>v2</main>;\n}\n",
  "components/Footer.tsx": "export default function Footer() {\n  return <footer>Verdant</footer>;\n}\n",
};
const THEME = {
  colors: { primary: "#1B4332" },
  fonts: { heading: "Fraunces", body: "Inter" },
  radius: "0.5rem",
};

let checks = 0;
let failures = 0;

async function check(label, fn) {
  checks += 1;
  try {
    await fn();
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL ${label}\n       ${error.message}\n`);
  }
}

process.stdout.write(`\nlocal stack ${API_URL}, database ${DB_CONTAINER}\n`);

const alice = await signedInUser("alice");
const bob = await signedInUser("bob");

const { data: project, error: projectError } = await alice.client
  .from("projects")
  .insert({
    user_id: alice.id,
    name: "Verdant",
    page_type: "landing",
    initial_prompt: "organic skincare for sensitive skin",
  })
  .select("id")
  .single();
if (projectError) throw projectError;

for (const [idx, files] of [
  [1, FILES_V1],
  [2, FILES_V2],
]) {
  const { error } = await alice.client.from("versions").insert({
    project_id: project.id,
    page_type: "landing",
    idx,
    prompt: `revision ${idx}`,
    files,
    theme: THEME,
  });
  if (error) throw error;
}

const { error: productError } = await alice.client.from("versions").insert({
  project_id: project.id,
  page_type: "product",
  idx: 1,
  prompt: "the product page",
  files: { "app/product/page.tsx": "export default function Page() {\n  return <main/>;\n}\n" },
  theme: THEME,
});
if (productError) throw productError;

process.stdout.write(`alice owns ${project.id} — landing v1, landing v2, product v1\n\n`);

try {
  /* ────────────────────────── the owner's own read ─────────────────────── */

  process.stdout.write("the owner reading her own shop\n");

  await check("returns the newest version of the page, not the first", async () => {
    const page = await readPastPageSource(alice.client, project.id, "landing");
    assert.ok(page, "the owner must be able to read her own shop");
    assert.equal(page.idx, 2);
    assert.equal(page.projectName, "Verdant");
    assert.deepEqual(Object.keys(page.files).sort(), [
      "app/page.tsx",
      "components/Footer.tsx",
      "components/Hero.tsx",
    ]);
    assert.match(page.files["app/page.tsx"], /v2/);
  });

  await check("keeps the page types apart", async () => {
    const page = await readPastPageSource(alice.client, project.id, "product");
    assert.ok(page);
    assert.equal(page.idx, 1);
    assert.deepEqual(Object.keys(page.files), ["app/product/page.tsx"]);
  });

  await check("brings the theme back through normalizeTheme", async () => {
    const page = await readPastPageSource(alice.client, project.id, "landing");
    assert.equal(page.theme.colors.primary, "#1B4332");
    assert.equal(page.theme.fonts.heading, "Fraunces");
  });

  /* ─────────────────────────── other people's shops ────────────────────── */

  process.stdout.write("\nsomebody else's shop\n");

  await check("a signed-in stranger gets nothing", async () => {
    const page = await readPastPageSource(bob.client, project.id, "landing");
    assert.equal(page, null, "RLS must not hand Bob Alice's source");
  });

  await check("a signed-out caller gets nothing", async () => {
    const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
    assert.equal(await readPastPageSource(anon, project.id, "landing"), null);
  });

  await check("a project id the model invented gets nothing", async () => {
    assert.equal(await readPastPageSource(alice.client, randomUUID(), "landing"), null);
    assert.equal(await readPastPageSource(alice.client, "not-a-uuid", "landing"), null);
    assert.equal(
      await readPastPageSource(alice.client, "'; drop table versions;--", "landing"),
      null,
    );
  });

  /* ─────────────────── the check standing behind the policy ────────────── */
  //
  // THIS GROUP BREAKS AN RLS POLICY ON PURPOSE. It is not a debugging leftover,
  // and the relaxed policy is restored below whatever happens.
  //
  // `readPastPageSource` compares the project's owner against auth.uid() even
  // though RLS has already filtered the row out — belt and braces, so a future
  // policy edit cannot quietly turn a model-supplied project id into a
  // cross-account read. While the policy is correct that comparison is
  // unreachable, which means a test of it passes without proving anything. The
  // only way to actually exercise it is to remove the thing that makes it
  // redundant, so the select policy is dropped to `using (true)` for two checks
  // — the first confirming the leak is real, so the second is not vacuous.

  process.stdout.write("\nwith the RLS policy deliberately broken\n");

  sql(`drop policy if exists "projects are self-readable" on public.projects;
       create policy "projects are self-readable" on public.projects for select using (true);`);

  try {
    await check("the broken policy really does leak — so the next check is not vacuous", async () => {
      const { data } = await bob.client.from("projects").select("id, user_id").eq("id", project.id);
      assert.equal(data.length, 1, "the policy edit did not take effect");
      assert.equal(data[0].user_id, alice.id);
    });

    await check("the ownership check still refuses, with the policy no longer helping", async () => {
      const page = await readPastPageSource(bob.client, project.id, "landing");
      assert.equal(page, null, "the explicit auth.uid() comparison is what has to catch this");
    });
  } finally {
    restorePolicy();
  }

  await check("the policy is back", async () => {
    const { data } = await bob.client.from("projects").select("id").eq("id", project.id);
    assert.deepEqual(data, [], "the database is still in the relaxed state");
  });
} finally {
  await alice.client.from("projects").delete().eq("id", project.id);
  await admin.auth.admin.deleteUser(alice.id);
  await admin.auth.admin.deleteUser(bob.id);
}

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n\n`);
process.exit(failures === 0 ? 0 : 1);

/** Puts 0001_init.sql's policy back. Loud on failure: a relaxed database is a trap. */
function restorePolicy() {
  try {
    sql(`drop policy if exists "projects are self-readable" on public.projects;
         create policy "projects are self-readable"
           on public.projects for select
           using (auth.uid() = user_id);`);
  } catch (error) {
    failures += 1;
    process.stderr.write(
      [
        "",
        "!!! COULD NOT RESTORE THE RLS POLICY — this database is left readable by anyone.",
        `!!! ${error.message}`,
        "!!! Run `npm run supabase:local:down`, or re-apply it by hand:",
        '!!!   drop policy if exists "projects are self-readable" on public.projects;',
        '!!!   create policy "projects are self-readable" on public.projects',
        "!!!     for select using (auth.uid() = user_id);",
        "",
      ].join("\n"),
    );
  }
}
