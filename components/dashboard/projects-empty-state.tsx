import Link from "next/link";

import { ArrowRightIcon, SparkleIcon } from "./icons";

interface ProjectsEmptyStateProps {
  /** Shown instead of the dock pointer when Supabase has no credentials yet. */
  notice?: string | null;
}

export function ProjectsEmptyState({ notice }: ProjectsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-amb-feature bg-amb-card px-6 py-16 text-center shadow-amb-feature">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amb-muted text-amb-muted-foreground">
        <SparkleIcon className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.025em] text-amb-foreground">
        No pages yet
      </h2>
      <p className="mt-2 max-w-[46ch] text-[14px] text-amb-muted-foreground">
        {notice ??
          "Pick a page type in the dock on the home screen, describe your shop, and the first page appears here."}
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-amb-row bg-amb-primary px-3.5 text-[14px] font-medium text-amb-primary-foreground transition-opacity hover:opacity-90"
      >
        Go to the dock
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
