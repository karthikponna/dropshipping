import Link from "next/link";

import type { ProjectListItem } from "./data";
import { FeatureCard, FeatureCardEyebrow } from "./feature-card";
import { formatCount, formatRelativeTime } from "./format";
import { ArrowRightIcon } from "./icons";
import { PageTypeBadge } from "./page-type-badge";

interface RecentProjectsCardProps {
  projects: readonly ProjectListItem[];
}

const MAX_ROWS = 4;

export function RecentProjectsCard({ projects }: RecentProjectsCardProps) {
  const rows = projects.slice(0, MAX_ROWS);

  return (
    <FeatureCard>
      <FeatureCardEyebrow>Recent pages</FeatureCardEyebrow>

      {rows.length === 0 ? (
        <p className="mt-3 text-[14px] text-amb-muted-foreground">
          Nothing saved yet. Describe a shop in the dock above and the first page lands here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-0.5">
          {rows.map((project) => (
            <li key={project.id}>
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="flex flex-col gap-1 rounded-amb-row p-2 transition-colors hover:bg-amb-muted"
              >
                <span className="truncate text-[14px] font-medium tracking-[-0.012em] text-amb-foreground">
                  {project.name}
                </span>
                <span className="flex items-center gap-2">
                  <PageTypeBadge pageType={project.page_type} />
                  <span className="truncate text-[12px] text-amb-muted-foreground">
                    {formatRelativeTime(project.updated_at)} ·{" "}
                    {formatCount(project.versionCount, "version")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/dashboard/projects"
        className="mt-auto inline-flex h-amb-control w-fit items-center gap-1.5 rounded-amb-row border border-amb-border px-2.5 text-[14px] text-amb-foreground transition-colors hover:bg-amb-muted"
      >
        All pages
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </Link>
    </FeatureCard>
  );
}
