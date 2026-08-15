import Link from "next/link";

import type { ProjectListItem } from "@/lib/dashboard/data";
import { formatCount, formatRelativeTime } from "@/lib/dashboard/format";
import { PageTypeBadge } from "./page-type-badge";
import { ProjectCardActions } from "./project-card-actions";

interface ProjectCardProps {
  project: ProjectListItem;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const builderHref = `/dashboard/projects/${project.id}`;

  return (
    <article className="flex flex-col rounded-amb-panel border border-amb-border bg-amb-card p-4 shadow-amb-sm transition-shadow hover:shadow-amb-md">
      <Link
        href={builderHref}
        className="truncate text-[15px] font-medium tracking-[-0.02em] text-amb-foreground hover:underline"
      >
        {project.name}
      </Link>

      <p className="mt-1 line-clamp-2 text-[13px] text-amb-muted-foreground">
        {project.initial_prompt || "No prompt saved."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PageTypeBadge pageType={project.page_type} />
        <span className="text-[12px] text-amb-muted-foreground">
          {formatCount(project.versionCount, "version")} · updated{" "}
          {formatRelativeTime(project.updated_at)}
        </span>
      </div>

      <ProjectCardActions
        projectId={project.id}
        projectName={project.name}
        builderHref={builderHref}
      />
    </article>
  );
}
