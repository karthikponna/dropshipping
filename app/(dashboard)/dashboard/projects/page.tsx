import type { Metadata } from "next";

export const metadata: Metadata = { title: "Projects" };

/* PLACEHOLDER — Wave 2 (dashboard-shell) replaces this with the saved-pages
   grid, reading ProjectRecord rows for the signed-in user. */
export default function ProjectsPage() {
  return (
    <div className="px-8 py-16">
      <h1>Projects</h1>
      <p className="mt-4 text-amb-muted-foreground">
        Scaffold only — the project grid lands in Wave 2.
      </p>
    </div>
  );
}
