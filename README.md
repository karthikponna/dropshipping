# DropShipping

Describe a shop in one sentence, pick **Landing page** or **Product page**, and Claude writes the
whole storefront — a real Next.js 15 + Tailwind file tree — streaming into a live preview as it is
written. Refine it in chat ("make the hero bigger", "change to a blue theme"), keep every generation
in version history, and download the result as a zip that runs with `npm install && npm run dev`.

```
prompt ──▶ /api/generate ──▶ Claude ──▶ file-tag parser ──▶ FileMap ──┬──▶ Sandpack adapter ──▶ live preview
                                                                     ├──▶ Supabase versions row
                                                                     └──▶ zip export (canonical tree)
```

---

## What it does

**Generation**

- Two page types with **separate, hard contracts**. A landing page must contain
  `Navbar, Hero, Features, Pricing, Testimonials, CTA, Footer`; a product page must contain
  `Navbar, Gallery, ProductInfo, PriceBlock, AddToCart, Specs, Reviews, Footer`. The required file
  list and a per-component brief are compiled into the system prompt from `lib/framework/`, and the
  page type is fixed for the life of a project.
- **Streaming**: files appear in the preview as they are written, not after the reply completes.
- **Art direction**: the model also picks a palette, a Google Fonts pairing and a corner radius, and
  builds with those exact values as Tailwind arbitrary values, so the styling never depends on a
  config file.
- **Refinement** diffs onto the existing tree. Only files the change actually touches are re-emitted;
  everything else stays byte-identical.
- **Self-repair**: if a required file never arrives, one targeted pass asks for exactly the missing
  paths rather than regenerating the site.
- **Typed failures**: missing/invalid key, Anthropic 429/5xx, a truncated stream and missing files
  each surface in the chat rail as a specific message, with a Retry button only where retrying can
  actually help.

**The app around it**

- Email/password auth (Supabase, no OAuth), with Postgres row-level security scoping every row to
  its owner.
- Dashboard: greeting stack, metric topline, and a floating AI dock — page-type toggle plus prompt —
  that creates the project and drops you straight into the builder with generation already running.
- Builder: conversation rail on the left, Preview/Code panel on the right, desktop/tablet/mobile
  width toggles, version history with restore, and Export .zip. Responsive: below `md` the two panes
  become a Chat/Preview toggle instead of being squeezed side by side.
- Version history: every generation is a row; restoring repoints the project at an older version and
  reloads it into the preview.
- Settings: paste your own Anthropic key. It is stored AES-256-GCM encrypted and never rendered back
  to the browser in plaintext.
- Two deliberately separate design systems — a sharp-cornered `#0562EF` marketing/auth surface and a
  near-black, soft-cornered admin console — that cannot bleed into each other (see
  [Design systems](#design-systems)).

**Not built** (so you are not looking for it): no OAuth, no team/sharing features, no custom domains
or one-click deploy of a generated shop, no image upload (generated sites use `picsum.photos`
placeholders), no editing of the generated code back into a saved version — the Code tab is
read-only, and the zip is the way out.

---

## Running it locally

### 1. Prerequisites

- Node.js 20.9+ to build and run the app. `npm test` additionally needs **Node 22.18+ or 24+**,
  because the test scripts import the TypeScript sources directly and rely on Node running them
  without a flag (developed against Node 25).
- A free [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com/settings/keys)

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
3. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.
4. Optional, but much easier for local development: under **Authentication → Providers → Email**,
   turn **Confirm email** off. With it on, signup returns "check your inbox" instead of signing you
   in, and you will need to click the emailed link first.

### 4. Configure the environment

```bash
cp .env.example .env.local
openssl rand -hex 32   # paste the output as APP_ENCRYPTION_KEY
```

Then fill in `.env.local`:

| Variable                        | Required                   | What it is                                                                                                                                    |
| ------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | for auth and persistence   | Project URL, e.g. `https://abcdefgh.supabase.co`. Public by design.                                                                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for auth and persistence   | The anon public key. Public by design — RLS is what protects the data.                                                                          |
| `ANTHROPIC_API_KEY`             | unless every user has own  | Server-side fallback key. Key resolution is: the signed-in user's stored key first, this second.                                                |
| `APP_ENCRYPTION_KEY`            | to store per-user keys     | 32 bytes as 64 hex chars (`openssl rand -hex 32`) or base64. Encrypts `profiles.anthropic_key_encrypted`. **Changing it orphans stored keys.** |

There is no service-role key: every query runs as the signed-in user through RLS, so the app never
needs one.

The app boots with all of these blank — Supabase-backed pages show a setup notice and generation
reports a missing key — which is useful for working on the UI, and nothing else. To see the builder
itself in that state, open `/dashboard/builder-harness`: a development-only page that renders the
real builder against a fixture project, so the preview, the code tab, the version drawer and the zip
export all work with no credentials at all. It 404s in production.

### 5. Run

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
| `npm run test:export`  | The zip export's file tree                                                         |
| `npm run verify`       | lint → typecheck → test → build, in that order                                     |

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
| `/dashboard/projects/[id]`     | The builder: chat rail, live preview, code, version history, export                |
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
status(connecting) → status(planning) → meta → theme → status(writing)
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
ownership check. It inserts the row, moves `projects.current_version_id`, names the project from the
model's `<meta>` if it is still unnamed, and reports the new id on the `done` frame.

The builder therefore never writes a version itself — it only reads history and, to restore, moves
the pointer with `PATCH /api/projects/[id] { currentVersionId }`. `GET /api/projects/[id]/versions`
is read-only for the same reason: a `POST` there would have meant two rows per generation.

A database failure during save does not throw away a finished site — it is reported in the rail as
"not saved to history" and the generation still previews. Ownership failures do throw.

### Data model

```
profiles(id → auth.users, email, full_name, anthropic_key_encrypted, created_at, updated_at)
projects(id, user_id, name, page_type, initial_prompt, current_version_id, created_at, updated_at)
versions(id, project_id, idx, prompt, files jsonb, theme jsonb, created_at)
```

RLS is on for all three; `profiles` and `projects` are keyed on `auth.uid()`, and `versions` inherits
ownership from its project. `versions.files` is the canonical `FileMap` — `{ "app/page.tsx": "…" }` —
and `idx` is a 1-based counter unique per project. Deleting a project cascades its versions.

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
  preview/             the Next.js → Sandpack adapter and its shims
  export/              the zip builder
  dashboard/           server reads, server actions, form state, formatting
  supabase/  auth/  crypto.ts  anthropic-key.ts
supabase/migrations/   the SQL to paste into the Supabase SQL editor
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
   shares a Supabase project, or stored user keys stop decrypting.
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
| Export         | `jszip`, imported dynamically so it is only fetched on click                                 |
| Analytics      | `@vercel/analytics`, `@vercel/speed-insights`                                                |

Sandpack covers preview and code display in one dependency, and its preview runs in a sandboxed
iframe — so a syntax error in generated code lands in Sandpack's own error overlay instead of taking
the app down with it.
