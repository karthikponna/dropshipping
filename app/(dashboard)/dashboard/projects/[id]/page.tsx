import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import {
  getDashboardSession,
  getProject,
  getProjectPages,
  isSchemaOutdated,
  listVersionSummaries,
  MIGRATION_HINT,
} from "@/lib/dashboard/data";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";

/**
 * The builder. Everything interactive lives in `BuilderWorkspace`; this file
 * resolves the route into the server reads it needs — the project, the newest
 * version of each page type, and the history list — and hands them over.
 *
 * Both pages are loaded up front rather than on demand: switching between the
 * landing and product page is a tab, and a tab that waits on the network to
 * paint a page the server already had would feel broken.
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
  if (session.status === "unconfigured") return <Notice>{SUPABASE_SETUP_HINT}</Notice>;
  if (session.status === "signed_out") redirect("/login");

  const project = await getProject(id);
  if (!project) {
    // A project that reads as missing because the database is a migration
    // behind is not a 404 — the row is right there, and saying "not found"
    // about somebody's shop is the wrong thing to say.
    if (await isSchemaOutdated()) return <Notice>{MIGRATION_HINT}</Notice>;
    notFound();
  }

  const [versions, pages] = await Promise.all([
    listVersionSummaries(id),
    getProjectPages(project),
  ]);

  return (
    <BuilderWorkspace
      autostart={query.autostart === "1"}
      initialVersions={versions}
      pages={pages}
      project={project}
    />
  );
}

/** Stands in for the builder when the database cannot answer for the project. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <h1 className="text-[30px] leading-[1.15] tracking-[-0.035em]">Builder</h1>
      <p className="mt-3 max-w-prose text-[14px] leading-[1.6] text-amb-muted-foreground">
        {children}
      </p>
    </div>
  );
}
