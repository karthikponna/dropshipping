import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import { getDashboardSession, getProjectWithVersion, listVersionSummaries } from "@/lib/dashboard/data";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";

/**
 * The builder. Everything interactive lives in `BuilderWorkspace`; this file
 * resolves the route into the three server reads it needs — the project, the
 * version currently pointed at, and the history list — and hands them over.
 *
 * `?autostart=1` is set by the dashboard dock, which creates the project row
 * without a version. The workspace acts on it once and strips it from the URL.
 */

export const metadata: Metadata = { title: "Builder" };

interface BuilderPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BuilderPage({ params, searchParams }: BuilderPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const session = await getDashboardSession();
  if (session.status === "unconfigured") return <SetupNotice />;
  if (session.status === "signed_out") redirect("/login");

  const project = await getProjectWithVersion(id);
  if (!project) notFound();

  const versions = await listVersionSummaries(id);
  const { current_version: currentVersion, ...record } = project;

  return (
    <BuilderWorkspace
      autostart={query.autostart === "1"}
      initialVersion={currentVersion}
      initialVersions={versions}
      project={record}
    />
  );
}

/** Supabase is not configured, so there is no project row to build against. */
function SetupNotice() {
  return (
    <div className="px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <h1 className="text-[30px] leading-[1.15] tracking-[-0.035em]">Builder</h1>
      <p className="mt-3 max-w-prose text-[14px] leading-[1.6] text-amb-muted-foreground">
        {SUPABASE_SETUP_HINT}
      </p>
    </div>
  );
}
