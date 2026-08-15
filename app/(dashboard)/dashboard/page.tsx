import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Dashboard" };

/* PLACEHOLDER — Wave 2 (dashboard-shell) replaces this with the amboras home:
   metric topline, centered greeting stack, the floating AI dock carrying the
   page-type segmented toggle + prompt box, then the feature card grid. */
export default function DashboardHomePage() {
  return (
    <div className="px-8 py-16">
      <p className="greeting">Good evening!</p>
      <p className="statement mt-1">Let&apos;s continue growing your business.</p>
      <p className="mt-6 text-amb-muted-foreground">
        Scaffold only — the console lands in Wave 2.
      </p>
      <div className="mt-8 flex gap-2">
        <Link
          href="/dashboard/projects"
          className="inline-flex h-amb-control items-center rounded-amb-row border border-amb-border px-3"
        >
          Projects
        </Link>
        <Link
          href="/dashboard/settings"
          className="inline-flex h-amb-control items-center rounded-amb-row border border-amb-border px-3"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}
