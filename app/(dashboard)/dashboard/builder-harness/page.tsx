import { notFound } from "next/navigation";

import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import { landingFixture } from "@/lib/preview/fixtures";
import { DEFAULT_THEME, type ProjectRecord, type VersionRecord, type VersionSummary } from "@/lib/types";

/**
 * Development-only harness: `/dashboard/builder-harness`.
 *
 * Renders the real `BuilderWorkspace` against a fixture project, so the
 * two-pane layout, the Sandpack preview, the version drawer, the export and the
 * `missing_key` error path can all be exercised in a browser with neither a
 * Supabase project nor an Anthropic key. Writes (restore, generate) hit the real
 * API routes and fail the way they would for a signed-out visitor.
 *
 * 404s in production so the fixture can never be mistaken for a real project.
 */

const NOW = "2026-08-15T12:00:00.000Z";

const project: ProjectRecord = {
  id: "harness-project",
  user_id: "harness-user",
  name: "Ember & Oak",
  page_type: "landing",
  initial_prompt: "A candle studio selling hand-poured soy candles for slow evenings at home.",
  current_version_id: "harness-version-2",
  created_at: NOW,
  updated_at: NOW,
};

const version: VersionRecord = {
  id: "harness-version-2",
  project_id: project.id,
  idx: 2,
  prompt: "Make the hero bigger",
  files: landingFixture,
  theme: { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: "#1B4332" } },
  created_at: NOW,
};

const versions: VersionSummary[] = [
  { id: "harness-version-2", project_id: project.id, idx: 2, prompt: "Make the hero bigger", created_at: NOW },
  {
    id: "harness-version-1",
    project_id: project.id,
    idx: 1,
    prompt: project.initial_prompt,
    created_at: "2026-08-15T11:00:00.000Z",
  },
];

export default function BuilderHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <BuilderWorkspace
      autostart={false}
      initialVersion={version}
      initialVersions={versions}
      project={project}
    />
  );
}
