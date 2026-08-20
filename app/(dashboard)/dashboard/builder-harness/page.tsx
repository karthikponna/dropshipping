import { notFound } from "next/navigation";

import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import { landingFixture, productFixture } from "@/lib/preview/fixtures";
import {
  DEFAULT_THEME,
  type ProjectPages,
  type ProjectRecord,
  type Theme,
  type VersionRecord,
  type VersionSummary,
} from "@/lib/types";

/**
 * Development-only harness: `/dashboard/builder-harness`.
 *
 * Renders the real `BuilderWorkspace` against a fixture project, so the
 * two-pane layout, the Sandpack preview, the page switcher, the version drawer,
 * the export and the `missing_key` error path can all be exercised in a browser
 * with neither a Supabase project nor an Anthropic key. Writes (restore,
 * generate) hit the real API routes and fail the way they would for a
 * signed-out visitor.
 *
 * The fixture has both pages built and sharing one theme, which is the state
 * the memory graph exists to produce.
 *
 * 404s in production so the fixture can never be mistaken for a real project.
 */

const NOW = "2026-08-15T12:00:00.000Z";
const EARLIER = "2026-08-15T11:00:00.000Z";

const theme: Theme = {
  ...DEFAULT_THEME,
  colors: { ...DEFAULT_THEME.colors, primary: "#1B4332" },
};

const project: ProjectRecord = {
  id: "harness-project",
  user_id: "harness-user",
  name: "Ember & Oak",
  page_type: "landing",
  initial_prompt: "A candle studio selling hand-poured soy candles for slow evenings at home.",
  current_version_id: "harness-landing-2",
  landing_version_id: "harness-landing-2",
  product_version_id: "harness-product-1",
  created_at: NOW,
  updated_at: NOW,
};

const pages: ProjectPages = {
  landing: {
    id: "harness-landing-2",
    project_id: project.id,
    page_type: "landing",
    idx: 2,
    prompt: "Make the hero bigger",
    files: landingFixture,
    theme,
    created_at: NOW,
  } satisfies VersionRecord,
  product: {
    id: "harness-product-1",
    project_id: project.id,
    page_type: "product",
    idx: 1,
    prompt: "A page for the smoked cedar candle",
    files: productFixture,
    theme,
    created_at: NOW,
  } satisfies VersionRecord,
};

const versions: VersionSummary[] = [
  {
    id: "harness-landing-2",
    project_id: project.id,
    page_type: "landing",
    idx: 2,
    prompt: "Make the hero bigger",
    created_at: NOW,
  },
  {
    id: "harness-product-1",
    project_id: project.id,
    page_type: "product",
    idx: 1,
    prompt: "A page for the smoked cedar candle",
    created_at: NOW,
  },
  {
    id: "harness-landing-1",
    project_id: project.id,
    page_type: "landing",
    idx: 1,
    prompt: project.initial_prompt,
    created_at: EARLIER,
  },
];

export default function BuilderHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <BuilderWorkspace
      autostart={false}
      initialVersions={versions}
      pages={pages}
      project={project}
    />
  );
}
