import type { Metadata } from "next";

import { isSchemaOutdated, listProjects, MIGRATION_HINT } from "@/lib/dashboard/data";
import { formatCount } from "@/lib/dashboard/format";
import { ProjectCard } from "@/components/dashboard/project-card";
import { ProjectsEmptyState } from "@/components/dashboard/projects-empty-state";
import { isSupabaseConfigured, SUPABASE_SETUP_HINT } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await listProjects();
  const configured = isSupabaseConfigured();

  const notice = !configured
    ? SUPABASE_SETUP_HINT
    : projects.length === 0 && (await isSchemaOutdated())
      ? MIGRATION_HINT
      : null;

  return (
    <div className="px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <h1 className="text-[30px] leading-[1.15] tracking-[-0.035em]">Projects</h1>
        <p className="pb-1 text-[14px] text-amb-muted-foreground">
          {projects.length === 0
            ? "Saved pages live here."
            : `${formatCount(projects.length, "page")} saved.`}
        </p>
      </header>

      <div className="mt-8">
        {projects.length === 0 ? (
          <ProjectsEmptyState notice={notice} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
