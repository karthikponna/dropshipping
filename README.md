# DropShipping

Describe a shop in one sentence, pick **Landing page** or **Product page**, and Claude writes the
whole storefront — a real Next.js 15 + Tailwind file tree — streaming into a live preview as it is
written. Refine it in chat ("make the hero bigger", "change to a blue theme"), keep every generation
in version history, and download the result as a zip that runs with `npm install && npm run dev`.

Then switch to the other page type and describe it. The second page comes out in the first page's
palette, fonts and section rhythm, because a **HydraDB** graph remembers what was already built —
within the session, and across sessions, so a new chat can start with *"rebuild the skincare shop I
made yesterday, but for candles"*.

```
prompt ──▶ /api/generate ──▶ recall (HydraDB) ──▶ Claude ──▶ file-tag parser ──▶ FileMap ──┬──▶ Sandpack adapter ──▶ live preview
                                     ▲                                                     ├──▶ Supabase versions row
                                     └────────────── ingest (HydraDB) ◀───────────────────┴──▶ zip export (canonical tree)
```

---

## What it does

**Generation**

- Two page types with **separate, hard contracts**. A landing page must contain
  `Navbar, Hero, Features, Testimonials, CTA, Footer`; a product page must contain
  `Navbar, Gallery, ProductInfo, PriceBlock, AddToCart, Specs, Reviews, Footer`. The required file
  list and a per-component brief are compiled into the system prompt from `lib/framework/`.
- **A project is a shop, not a page.** Both page types live in one project, each with its own tree,
  history and conversation, and the switcher in the chat rail moves between them. Building the second
  one inherits the first one's design (see [Memory](#memory-hydradb)).
- **One site, not two pages.** The shop's routes are fixed — landing at `/`, product at `/product`
  (`lib/framework/routes.ts`) — and both prompts are told the whole route table, so the landing page's
  calls to action link to `/product`, the product page links back, and the navbar and footer are
  written to be the same markup on either route. The preview has its own route switcher, which lists a
  route that has not been built yet and offers to build it, and following a cross-page link inside the
  preview moves it to the other route.
- **Streaming**: files appear in the preview as they are written, not after the reply completes.
- **Art direction**: the model also picks a palette, a Google Fonts pairing and a corner radius, and
  builds with those exact values as Tailwind arbitrary values, so the styling never depends on a
  config file.
- **Your own photos.** Attach images in the composer, on either page type. Claude is shown them
  alongside the prompt — so the palette and every physical description come off the real product —
  and the generated markup points `<img src>` at those same URLs. Anything you did not upload still
  falls back to `picsum.photos`.
- **Refinement** diffs onto the existing tree. Only files the change actually touches are re-emitted;
  everything else stays byte-identical.
- **Self-repair**: if a required file never arrives, one targeted pass asks for exactly the missing
  paths rather than regenerating the site.
- **Typed failures**: missing/invalid key, Anthropic 429/5xx, a truncated stream and missing files
  each surface in the chat rail as a specific message, with a Retry button only where retrying can
  actually help.

**Memory**

- The product page inherits the landing page's palette, fonts, radius and section conventions.
- A refinement only sees the files the change plausibly touches, walked out of an import graph,
  rather than the whole tree.
- A brand-new chat can recall an earlier shop by description and rough time ("the one from
  yesterday"), and build the new prompt on top of it — including reading that shop's actual
  components out of the database, so "same UI, just change the name" adapts the real code rather
  than reusing the palette.
- All of it runs on a [HydraDB](https://github.com/hydra-db/hydradb) property graph, and all of it is
  optional — with no node configured, generation behaves exactly as it did before.

**The app around it**

- Supabase auth: Google (OAuth/PKCE, exchanged for a session in `app/auth/callback`) or email and
  password, with Postgres row-level security scoping every row to its owner.
- Dashboard: greeting stack, metric topline, and a floating AI dock — page-type toggle plus prompt —
  that creates the project and drops you straight into the builder with generation already running.
- Builder: conversation rail on the left, Preview/Code panel on the right, a Landing/Product switcher
  in the rail's header for what you are *editing* and a route switcher in the preview toolbar for what
  you are *looking at*, desktop/tablet/mobile width toggles, version history with restore, and
  Export .zip. Responsive: below `md` the two panes become a Chat/Preview toggle instead of being
  squeezed side by side.
- Version history: every generation is a row, scoped to its page type; restoring repoints the project
  at an older version and reloads it into the preview.
- Export: a shop with both pages downloads as **one** Next.js app — landing at `/`, product at
  `/product`, one layout, one theme. A route the shop links to but has not built yet ships as a short
  "coming soon" page, so a landing-only export has no dead links.
- Settings: paste your own Anthropic key. It is stored AES-256-GCM encrypted and never rendered back
  to the browser in plaintext.
- Two deliberately separate design systems — a sharp-cornered `#0562EF` marketing/auth surface and a
  near-black, soft-cornered admin console — that cannot bleed into each other (see
  [Design systems](#design-systems)).

**Not built** (so you are not looking for it): no OAuth provider beyond Google, no team/sharing
features, no custom domains
or one-click deploy of a generated shop, no editing of the generated code back into a saved version —
the Code tab is read-only, and the zip is the way out. Uploaded photos are referenced by URL rather
than bundled into the zip, so an exported shop keeps pointing at your Supabase bucket until you move
the files into `public/` yourself.

---

## Running it locally

### 1. Prerequisites

- Node.js 20.9+ to build and run the app. `npm test` additionally needs **Node 22.18+ or 24+**,
  because the test scripts import the TypeScript sources directly and rely on Node running them
  without a flag (developed against Node 25).
- A free [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- Docker, for the local HydraDB node. Optional — skip it and everything works except memory.

### 2. Install

```bash
git clone <this-repo> dropshipping
cd dropshipping
npm install
```

### 3. Create the Supabase project and run the migration

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) and wait for it to
   finish provisioning.
2. Open **SQL Editor → New query**, paste the entire contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and **Run**. This creates
   `profiles`, `projects` and `versions`, turns on RLS with owner-only policies on all three, and
   installs the trigger that creates a profile row when someone signs up. It is safe to re-run.
3. Run [`supabase/migrations/0002_page_types.sql`](supabase/migrations/0002_page_types.sql) the same
   way. It makes a project hold both page types: `versions.page_type`, a per-page uniqueness index on
   `idx`, and `projects.landing_version_id` / `projects.product_version_id`. Existing rows are
   backfilled from the project's page type, so it is safe on a database that already has projects,
   and safe to re-run.
4. Run [`supabase/migrations/0003_shop_assets.sql`](supabase/migrations/0003_shop_assets.sql) the same
   way. It creates the `shop-assets` storage bucket that the composer's photo uploads go into. The
   bucket is **public**, because a generated shop has to keep loading its images after it is exported
   and deployed elsewhere, and because Anthropic fetches them by URL to look at them. Writes are still
   owner-scoped: the policies require the first path segment to be the uploader's user id. Safe to
   re-run.
5. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.
6. Optional, but much easier for local development: under **Authentication → Providers → Email**,
   turn **Confirm email** off. With it on, signup returns "check your inbox" instead of signing you
   in, and you will need to click the emailed link first.

### 4. Configure the environment

```bash
cp .env.example .env.local
openssl rand -hex 32   # paste the output as APP_ENCRYPTION_KEY
```

Then fill in `.env.local`:

| Variable                                | Required                   | What it is                                                                                                                                    |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`              | for auth and persistence   | Project URL, e.g. `https://abcdefgh.supabase.co`. Public by design.                                                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | for auth and persistence   | The publishable key (`sb_publishable_…`). Older projects issue a legacy anon JWT instead — set that as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Public by design; RLS is what protects the data. |
| `ANTHROPIC_API_KEY`                     | unless every user has own  | Server-side fallback key. Key resolution is: the signed-in user's stored key first, this second.                                                |
| `APP_ENCRYPTION_KEY`                    | to store per-user keys     | 32 bytes as 64 hex chars (`openssl rand -hex 32`) or base64. Encrypts `profiles.anthropic_key_encrypted`. **Changing it orphans stored keys.** |
| `HYDRADB_URL`, `HYDRADB_TOKEN`          | for memory                 | The graph node. Unset, memory is off and nothing else changes. The rest (`HYDRADB_GRAPH`, `_NAMESPACE`, `_CELL_ID`, `_TIMEOUT_MS`) have working defaults. |

There is no service-role key: every query runs as the signed-in user through RLS, so the app never
needs one.

The app boots with all of these blank — Supabase-backed pages show a setup notice and generation
reports a missing key — which is useful for working on the UI, and nothing else. To see the builder
itself in that state, open `/dashboard/builder-harness`: a development-only page that renders the
real builder against a fixture project with both pages built, so the switcher, the preview, the code
tab, the version drawer and the zip export all work with no credentials at all. It 404s in
production.

### 5. Start HydraDB (optional)

```bash
npm run hydra:up      # docker compose up, then wait until it answers a query
npm run hydra:probe   # round-trip every Cypher shape the app relies on
npm run hydra:check   # ingest a shop, inherit its design, recall it a day later
```

`hydra:up` creates `.hydradb/` (store, cache and the node's auth token), starts a single-node
HydraDB on `127.0.0.1:8443`, and polls until it can actually serve a read — the port opens well
before the node is usable, and a dev server started off a bare `docker compose up` loses its first
few memory writes. The defaults in `.env.example` match what it serves, so no configuration is
needed. `npm run hydra:down` stops it; the graph survives, in the bind mount.

Skip this and the app still runs: every `lib/hydra` entry point becomes a no-op, and the chat rail
simply never shows a memory line.

### 6. Prove the RLS story (optional)

```bash
npm run supabase:local:up     # Docker; the first run pulls a few images
npm run supabase:local:rls
npm run supabase:local:down
```

`read_past_files` is the only place a generation opens Postgres for source code, and the project id
it reads with is supplied by the model — so `readPastPageSource` is the one function in the app where
getting authorisation wrong means serving somebody else's shop. This check pins that down against a
real database: the owner gets her newest version, a signed-in stranger gets null, a signed-out caller
gets null, and an invented id gets null.

**It deliberately breaks an RLS policy, on purpose, and restores it afterwards.** That is the point
of the exercise rather than a leftover. The ownership comparison in `readPastPageSource` is
belt-and-braces — RLS has already filtered the row out by the time it runs — which means a test of it
passes while proving nothing. So the select policy is dropped to `using (true)` for two checks: the
first asserts the leak is now real, so that the second, which asserts the read still refuses, is not
vacuous. The policy goes back in a `finally`, there is a check afterwards confirming it did, and if
the restore itself fails the script says so loudly with the SQL to paste.

It cannot run against your hosted project, and that is not a shortcut. Signing in programmatically
needs a confirmable email, a service-role key or the JWT secret; a hosted project with email
confirmation on offers none of the three, so no script can obtain a session there. It also needs a
database it is allowed to break. Hence a local stack, built from `supabase/migrations` — the same
tables and the same policies production runs. `supabase:local:up` generates `supabase/config.toml`
on first use and excludes the analytics containers, which fail their health check and take the whole
stack down with them.

This is not part of `npm test`, which stays offline and needs no Docker.

### 7. Run

```bash
npm run dev     # http://localhost:3000
```

Sign up at `/signup`, then describe a shop in the dock on `/dashboard`.

---

## npm scripts

| Script                 | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`          | Next dev server on :3000                                                          |
| `npm run build`        | Production build                                                                  |
| `npm start`            | Serve a production build                                                          |
| `npm run lint`         | ESLint (`eslint-config-next`) across the repo                                      |
| `npm run typecheck`    | `tsc --noEmit`, strict                                                             |
| `npm test`             | All three offline suites below                                                     |
| `npm run test:ai`      | Parser, stream framing, error mapping, stream client, generation pipeline           |
| `npm run test:preview` | The Next.js → Sandpack adapter against realistic (and broken) fixture trees         |
| `npm run test:export`  | The zip export's file tree, single-page and both-pages-in-one-app                  |
| `npm run verify`       | lint → typecheck → test → build, in that order                                     |
| `npm run hydra:up`     | Start the local HydraDB node and wait until it answers                             |
| `npm run hydra:probe`  | Round-trip every Cypher shape `lib/hydra` issues, against the running node          |
| `npm run hydra:check`  | Ingest, inheritance, context narrowing and cross-session recall, against the node   |
| `npm run hydra:trace`  | One real investigation turn: the tools Claude called, and the brief it wrote        |
| `npm run hydra:trace:cross` | The cross-session case: three past shops, then "the same as yesterday" in a new one |
| `npm run hydra:logs`   | Follow the node's output                                                           |
| `npm run hydra:down`   | Stop the node (the graph survives in `.hydradb/`)                                   |
| `npm run supabase:local:up`   | Start a throwaway local Supabase stack from `supabase/migrations`            |
| `npm run supabase:local:rls`  | Prove the past-work read only ever serves the owner their own source          |
| `npm run supabase:local:down` | Stop and discard that stack                                                  |

The tests need no network, no API key and no framework: they are plain `.mjs` scripts that Node runs
against the TypeScript sources directly, with a small resolver hook teaching Node the `@/*` alias.
A generation is exercised end to end against a fake model and a recorded NDJSON transcript, so the
whole streaming path — including every failure shape the UI has to render — is covered without
spending a token.

---

## Architecture

### Route map

| Route                          | What it is                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `/`                            | Marketing landing page                                                             |
| `/login`, `/signup`            | Email/password auth                                                                |
| `/dashboard`                   | Greeting, metrics, the AI dock that starts a project                               |
| `/dashboard/projects`          | Saved pages                                                                        |
| `/dashboard/projects/[id]`     | The builder: chat rail, page switcher, live preview, code, version history, export |
| `/dashboard/settings`          | Anthropic key                                                                      |
| `/dashboard/builder-harness`   | The builder against a fixture project. Development only; 404s in production         |
| `POST /api/generate`           | Streams a generation as NDJSON, and saves it                                       |
| `/api/projects`                | `GET` list, `POST` create                                                          |
| `/api/projects/[id]`           | `GET` one, `PATCH` rename or restore a version, `DELETE`                           |
| `/api/projects/[id]/versions`  | `GET` version history (read-only — see [Who writes a version](#who-writes-a-version)) |

### Previewing "Next.js" in the browser

Sandpack cannot run a Next.js server, and shipping a second real Next.js runtime to the browser is
not an option. The resolution is a split:

**Claude emits a canonical Next.js tree. That tree is what we store and export. A thin adapter maps
a throwaway copy of it into a `vite-react-ts` Sandpack project purely for preview.**

`lib/preview/toSandpack.ts` owns that mapping, and it never mutates the canonical tree:

- rewrites module specifiers only, never JSX call sites: `@/components/Hero` becomes a relative
  path, and `next/image` / `next/link` / `next/font/google` resolve to tiny shim modules that render
  `<img>` and `<a>`
- drops `"use client"` / `"use server"` directives
- keeps only `app/page.tsx` out of `app/` — the rest of the App Router is server plumbing — and wraps
  it as the sandbox root `App.tsx`
- writes an `index.html` carrying the Tailwind Play CDN plus a `tailwind.config` and Google Fonts
  links built from the generation's own theme
- **stubs whatever an import asks for but the tree does not have yet**, which is what makes a
  half-streamed generation render skeleton sections instead of a syntax error

It is called on every stream tick, so it is total by construction: any unexpected failure degrades to
a placeholder project rather than throwing. Three separate guards keep the bundler from being rebuilt
on every token — commits are throttled while streaming, a content fingerprint drops no-op updates,
and the Sandpack instance is mounted once per project rather than per generation.

Because the exported tree is the untouched canonical one, `lib/export/project-zip.ts` only has to add
what the model never emits — `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
`app/layout.tsx`, `app/globals.css` (Tailwind v4 `@theme` block built from the generation's theme),
`theme.json`, `.gitignore` and a README. Generated files always win: if the model wrote its own
`app/layout.tsx`, the scaffold version is skipped. The output is deterministic, so the same project
exports to the same bytes.

A shop with both pages exports as one app rather than two zips. The two trees cannot simply be
merged — both frameworks emit `app/page.tsx`, `components/Navbar.tsx` and `components/Footer.tsx`, so
one would silently overwrite the other — so the landing page keeps the root and the product page
moves wholesale into `app/product/` and `components/product/`, with its `@/components/*` imports
rewritten to match. Relative imports are left alone: the folder moves as a unit. The layout, the
stylesheet and `theme.json` are written once, which is what makes the two pages look like one shop.

### The streaming file-tag protocol

JSON parses badly mid-flight — you cannot read a half-written object — so the model emits delimited
blocks an incremental parser can open as they arrive:

```
<meta>{"name":"Ember & Oak","summary":"Hand-poured soy candles for slow evenings."}</meta>
<theme>{"colors":{"primary":"#1B4332"},"fonts":{"heading":"Fraunces","body":"Inter"},"radius":"0.25rem"}</theme>
<file path="components/Hero.tsx">
export default function Hero() { … }
</file>
```

`lib/ai/parser.ts` turns that byte stream into `GenerationEvent`s, holding back just enough of the
tail to recognise a delimiter split across two chunks, and never mistaking a `<` inside a generic,
a comparison or a JSX tag for a tag of its own. The route serialises those events as NDJSON — one
JSON object per line — and `lib/ai/stream-client.ts` reads them back:

```
status(connecting)
  → [status(investigating) → memory   (refinements only: Claude queries the graph)]
  → status(recalling) → [memory…]
  → status(planning) → meta → theme → status(writing)
  → file_start / file_delta… / file_complete   (per file)
  → [status(repairing) → one targeted pass for missing files]
  → status(saving) → status(complete) → done{files, theme, meta, versionId}
```

Every failure, before or during the stream, arrives as exactly one terminal `error` frame carrying a
`GenerationErrorCode` and a `retryable` flag. Nothing escapes as an unhandled 500, and the client
never rejects — so the builder has one code path, and the chat rail decides what to render from the
code alone.

Images are always `https://picsum.photos/seed/<slug>/<w>/<h>`: a seeded picsum URL always resolves,
while remembered Unsplash photo IDs are hallucinations that 404 and leave the page full of broken
images.

### Who writes a version

Exactly one code path writes a `versions` row: `persistGeneratedVersion`, called from the generation
pipeline behind `POST /api/generate`, which already holds the finished tree and has done the
ownership check. It inserts the row, moves `projects.current_version_id` and the pointer for the page
type it just built, names the project from the model's `<meta>` if it is still unnamed, and reports
the new id on the `done` frame. Ingesting the generation into the graph happens immediately after,
and is allowed to fail without failing the save.

The builder therefore never writes a version itself — it only reads history and, to restore, moves
the pointer with `PATCH /api/projects/[id] { currentVersionId }`. `GET /api/projects/[id]/versions`
is read-only for the same reason: a `POST` there would have meant two rows per generation.

A database failure during save does not throw away a finished site — it is reported in the rail as
"not saved to history" and the generation still previews. Ownership failures do throw.

### Data model

```
profiles(id → auth.users, email, full_name, anthropic_key_encrypted, created_at, updated_at)
projects(id, user_id, name, page_type, initial_prompt,
         current_version_id, landing_version_id, product_version_id, created_at, updated_at)
versions(id, project_id, page_type, idx, prompt, files jsonb, theme jsonb, created_at)
```

RLS is on for all three; `profiles` and `projects` are keyed on `auth.uid()`, and `versions` inherits
ownership from its project. `versions.files` is the canonical `FileMap` — `{ "app/page.tsx": "…" }` —
and `idx` is a 1-based counter unique per project **and page type**, so a project's landing and
product pages each count from v1. Deleting a project cascades its versions.

`projects` carries three version pointers rather than one. `landing_version_id` and
`product_version_id` are what the builder boots each page from; `current_version_id` is the last
thing generated or restored, whichever page it belongs to, and is what the dashboard's project cards
preview. `page_type` on the project is now only the page it started as.

### Memory (HydraDB)

Postgres holds what was built. The graph holds *how things relate* — which is the question every
memory feature here turns out to be asking, and the reason for a graph rather than another table.

```
User ──OWNS──▶ Project ──HAS_SESSION──▶ Session ──HAS_GENERATION──▶ Generation
                  │                                                    │
                  │                                        ┌───────────┼──────────────┐
                  │                                        ▼           ▼              ▼
                  │                                  USES_THEME    PRODUCED       FOLLOWS
                  │                                        │           │              │
                  │                                      Theme    Component ──IMPORTS──▶ Component
                  │                                                    ▲
                  └──MENTIONS──▶ Concept ◀──MENTIONS── Generation      │
                                    │                                  │
                                    └──MENTIONED_BY──▶ Project    DERIVED_FROM (product ◀── landing)
```

Three reads run before the model is called, in `lib/ai/memory.ts`:

- **Inherited design** — generating a page type this project has never built walks to the sibling
  page's newest generation, reads its `Theme` and its component summaries, and makes them a
  constraint in the prompt. This is why a product page comes out in the landing page's colours
  without the user restating them, and the resulting generation is linked back with `DERIVED_FROM`.
- **Bounded code context** — a refinement seeds from the components the instruction plausibly names,
  walks `IMPORTS` outwards a bounded number of hops, and sends only those files. The rest are listed
  as withheld, so the model knows they exist and does not invent replacements. A ten-component shop
  stops paying ten components' worth of tokens to move one button.
- **Cross-session recall** — the prompt is reduced to concepts (stopwords dropped, plurals and
  synonyms folded, unigrams and bigrams kept) and, when it refers to past work at all, matching
  `Concept` nodes fan out to the projects that mention them, ranked by shared concepts and recency,
  narrowed by any time cue in the prompt. That is what makes *"the shop I built yesterday"* resolve.

  A request can also reach backwards while describing nothing at all: *"create a website same as
  yesterday, take the same UI, just change the name to Apple"* reduces to *yesterday, take, change,
  name, apple* — every content word about the new page, none about the old one. There is one
  fallback for that, and it is deliberately narrow: with a time cue **and** an explicit request for
  sameness, recall resolves to the newest shop inside the window. Both conditions matter. *"That
  motorcycle parts catalogue I built last week"* names a subject, and a subject can be wrong, so a
  user who never built one finds nothing rather than finding their skincare site.

Whatever is recalled is reported in the chat rail as a memory line, so the user can see why a page
came out the way it did rather than being quietly steered.

#### The investigation turn

Those three reads all guess on the model's behalf. By the fourth or tenth instruction of a sitting
that stops working: *"now make that narrower"* has no referent in itself, and the heuristic that
matches words against component names has nothing to match. So before a refinement is written,
Claude gets to query the graph itself.

`lib/ai/investigate.ts` runs a short non-streaming turn with four read-only tools over
`lib/hydra/inspect.ts`:

| Tool | Graph read |
|---|---|
| `session_history` | `Session ─HAS_GENERATION▶ Generation`, ordered by `created_at` |
| `list_components` | `Component {project_id, page_type}` — metadata, never source |
| `related_files` | batched `IMPORTS` fan-out from the paths it names |
| `read_files` | full source, from the tree the browser sent |

The model looks around, opens the files it decides the change touches, and replies with a short
brief. **Whatever it opened becomes the file set the writing turn is shown** — a much better answer
to "what does this change touch" than string matching, because it is made after reading what the
user asked for three turns ago. The entry file is added unconditionally, since a change that adds or
removes a section has to be wired in there. It is capped at six files and four tool rounds, and if
narrowing would leave all but one file it is abandoned as pointless.

#### Reusing an earlier shop's code

The same turn runs on a **create** that reaches backwards, with a different set of tools, because
*"same as yesterday, just change the name"* is a request to copy a page nobody has loaded. There is
no tree in the request, and `read_files` serves the tree the browser posted — so in a new session
that path has nothing to give.

| Tool | Read |
|---|---|
| `past_shops` | `User ─OWNS▶ Project ─HAS_GENERATION▶ Generation` — every shop, with an ISO date and `days_ago` per page |
| `past_components` | `Component {project_id, page_type}` of a past shop — metadata, never source |
| `read_past_files` | full source, from Postgres `versions.files` |

`read_past_files` is the only place a generation opens the database for code, and the project id it
is given comes from the model. `lib/ai/past-project.ts` therefore checks ownership explicitly on
every read as well as running the query as the signed-in user through RLS — belt and braces, because
getting this wrong means serving somebody else's source.

The ordering follows from that. A refinement investigates first and then recalls; a create recalls
first, because the investigation needs the project id recall resolved before it can point a tool at
it. What the model opens is quoted into the writing prompt as `<file>` blocks under an instruction
to *edit* those components rather than design something resembling them.

The file budget here is deliberately not the refinement's. A refinement wants the two or three files
one change touches; a create turn copying a page wants all of them, because every file it does not
open is a section the writing turn has to invent from prose — which is how "take the same UI" comes
back as a different site. So it is sized off the frameworks: a whole page in a single call, plus
headroom. `MAX_RECALLED_SOURCE_CHARS` (90k, against a typical shop's 60k) is the backstop behind
that rather than the thing doing the choosing, and when it does bite it drops from the end of a list
ordered entry file first, then sections top to bottom, and tells the model what it is not seeing.

`npm run hydra:trace:cross` runs the whole thing against live Claude and a live graph: three shops
seeded days apart, then one new empty session asking for "the same as yesterday".

Two things worth being explicit about. The investigation is a **separate turn on purpose**: a
generation streams because its output *is* the file protocol, and a turn that paused to call a tool
would break that mid-file, so investigation finishes in full before the writing stream opens. And it
is **plain Messages-API tool use** — `tools`, `tool_use`, `tool_result` — not the Claude Agent SDK,
which brings an agent loop and filesystem tools this has no use for.

When it runs, the heuristic narrowing above is skipped rather than run twice, and the chat rail says
how many lookups it made and what it focused on.

After a generation persists, `lib/hydra/ingest.ts` writes the whole shape back in two batched
statements — nodes, then edges — including the Postgres `project_id` and `version_id` as properties,
so any graph answer can be resolved back to a real row.

Some notes on the dialect, since HydraDB's OpenCypher subset is narrower than Neo4j's and the shape
of `lib/hydra/schema.ts` follows directly from it: an `UNWIND` vertex upsert sets exactly one label;
relationship-upsert endpoints each carry exactly one label; list parameters are legal only as
`UNWIND` input, never as `IN $list`; a bare `RETURN 1` is rejected, since only `MATCH … RETURN`
executes; and a read-side `UNWIND MATCH` takes no labels and binds the row id to the pattern's
*source*, which is why the graph materialises a reverse `MENTIONED_BY` edge instead of traversing
`MENTIONS` backwards.

One more that is easy to miss because it only bites in production: a write's idempotency key is
derived from the request's `query_id`, and if the client does not send one the node generates
`http-query-<n>` from a counter that restarts with the process. Left alone, the first writes after
any node restart collide with keys already stored under different payloads and are rejected — memory
would quietly stop recording, exactly at the moment nobody is watching. `lib/hydra/client.ts` sends
a fresh uuid as `query_id` on every request instead.

`scripts/hydra-probe.sh` pins every one of those against a running node, so a HydraDB upgrade that
changes them fails there rather than in a generation, and `npm run hydra:check` exercises the layer
above it — ingest, inheritance, narrowing and recall — end to end against real data it then deletes.

Everything in `lib/hydra` degrades to nothing. Unconfigured, unreachable, slow past
`HYDRADB_TIMEOUT_MS`, or answering something unexpected: the reads return empty context, the writes
are dropped, the failure is logged once rather than per query, and the generation proceeds. Memory
is never allowed to be the reason a site does not get built.

### Secrets

A user's own Anthropic key is encrypted with AES-256-GCM under `APP_ENCRYPTION_KEY` before it is
stored (`v1.<base64(iv | authTag | ciphertext)>`), decrypted only at request time on the server, and
shown back only as `sk-ant-…9f2a`. Request-time resolution is user key → `ANTHROPIC_API_KEY`, and if
neither exists the generation fails with `missing_key`, which the builder renders with a link
straight to Settings.

### Design systems

Two token layers live in one app and must never bleed:

- **Marketing and auth** (`/`, `/login`, `/signup`): zero border radius, `#0562EF`, Space Grotesk /
  DM Sans / DM Mono, corner-tick frames and mono `[n/n]` counters.
- **Dashboard** (everything under `/dashboard`): Geist, near-black `#171717` primary, a 255px
  `#FAFAFA` sidebar, 8px rows, 12px panels, 28px feature cards, a 32px floating dock.

Raw CSS variables and base element styles for each are scoped to a wrapper class applied by the
matching route-group layout (`.sm-scope`, `.amb-scope`). Tailwind utilities cannot be scoped —
Tailwind emits them at the top level — so they are namespaced instead: every supermemory token is
`sm-*` and every Amboras token is `amb-*`. `bg-sm-blue` and `bg-amb-primary` cannot collide, so
neither system can silently inherit the other's values.

### Layout of the source

```
app/
  (marketing)/         landing + login + signup      .sm-scope
  (dashboard)/         console + builder             .amb-scope
  api/generate/        streaming generation route
  api/projects/        project + version CRUD
components/
  marketing/  dashboard/  builder/  preview/         components only
lib/
  types.ts             every shared contract in the app
  framework/           the per-page-type component manifests
  ai/                  prompts, Anthropic client, parser, pipeline, stream client
                       memory.ts bridges the pipeline to the graph
                       tools.ts + investigate.ts let Claude query the graph itself
                       past-project.ts reads an earlier shop's source back out of Postgres
  hydra/               the memory graph: client, schema, ids, ingest, retrieve,
                       inspect (the model-driven reads), concept extraction,
                       the component import graph
  preview/             the Next.js → Sandpack adapter and its shims
  export/              the zip builder
  uploads/             browser-side downscale and upload of attached photos
  dashboard/           server reads, server actions, form state, formatting
  supabase/  auth/  crypto.ts  anthropic-key.ts
supabase/migrations/   the SQL to paste into the Supabase SQL editor
scripts/               hydra-up.sh, hydra-probe.sh
```

`lib/types.ts` is the single source of vocabulary — `PageType`, `FileMap`, `Theme`,
`GenerationEvent`, `GenerationErrorCode`, `ProjectRecord`, `VersionRecord`. Add to it rather than
redefining a shape locally.

---

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new). The framework
   preset is detected; no build settings need changing.
2. Add the environment variables from the table above under **Settings → Environment Variables**, for
   Production and Preview both. `APP_ENCRYPTION_KEY` must be the same value in every environment that
   shares a Supabase project, or stored user keys stop decrypting. Leave the `HYDRADB_*` variables
   out unless you have a node Vercel can reach — a localhost URL there just means every memory read
   times out and returns nothing, which costs a few hundred milliseconds per generation for no gain.
3. In Supabase, add your deployed origin under **Authentication → URL Configuration** (Site URL, and
   `https://your-app.vercel.app/**` under Redirect URLs) so confirmation links come back to the right
   place.
4. Analytics are already wired: `@vercel/analytics` and `@vercel/speed-insights` are mounted in
   `app/layout.tsx`, and both start reporting once you enable **Analytics** and **Speed Insights** on
   the project in the Vercel dashboard. Nothing is sent while running locally.

`POST /api/generate` runs on the Node runtime with `maxDuration = 300`, which needs a plan that
allows a 300s function; on Hobby, lower it in `app/api/generate/route.ts` (Hobby caps at 60s) or
expect long generations to be cut off mid-stream — which the client reports as `truncated_stream`
rather than silently truncating a site.

---

## Tech stack

| Area           | Choice                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------ |
| Framework      | Next.js 15 (App Router), React 19, TypeScript strict                                        |
| Styling        | Tailwind CSS v4 (`@theme`, no `tailwind.config.js`)                                         |
| AI             | `@anthropic-ai/sdk`, streaming, model pinned in `lib/ai/model.ts`                           |
| Preview + code | `@codesandbox/sandpack-react` — sandboxed iframe preview *and* the syntax-highlighted editor |
| Auth + data    | Supabase (`@supabase/ssr`) + Postgres with RLS                                              |
| Memory         | [HydraDB](https://github.com/hydra-db/hydradb) property graph over its HTTP Cypher API      |
| Export         | `jszip`, imported dynamically so it is only fetched on click                                 |
| Analytics      | `@vercel/analytics`, `@vercel/speed-insights`                                                |

Sandpack covers preview and code display in one dependency, and its preview runs in a sandboxed
iframe — so a syntax error in generated code lands in Sandpack's own error overlay instead of taking
the app down with it.
