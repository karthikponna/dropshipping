import type { Metadata } from "next";

export const metadata: Metadata = { title: "Builder" };

/* PLACEHOLDER — Wave 3 (builder) replaces this with the builder: chat rail on
   the left, Preview/Code tabs with device toggles on the right, and the
   version history drawer. Params are a Promise in Next 15. */
export default async function BuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="px-8 py-16">
      <h1>Builder</h1>
      <p className="mt-4 font-amb-mono text-amb-muted-foreground">project {id}</p>
      <p className="mt-4 text-amb-muted-foreground">
        Scaffold only — the builder lands in Wave 3.
      </p>
    </div>
  );
}
