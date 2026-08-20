/**
 * Shown the instant a project is clicked, until the builder's server reads
 * resolve.
 *
 * Opening a project is three awaited round trips — the session, the project row
 * and then its versions and pages — and Next holds the old screen until they
 * finish. Without this the recent-pages list and the projects table look like
 * they ignored the click, which reads as a broken link rather than a slow one.
 *
 * It mirrors the builder's own frame — same padding, same two-column split at
 * `md` — so the real workspace lands in place rather than shifting everything.
 */

const BLOCK = "animate-pulse rounded-amb-row bg-amb-muted";

export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4">
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(300px,340px)_1fr] lg:gap-4 xl:grid-cols-[400px_1fr]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 rounded-amb-panel border border-amb-border bg-amb-card p-4">
          <div className="flex items-center gap-2">
            <span className={`${BLOCK} h-5 flex-1`} />
            <span className={`${BLOCK} h-7 w-28 shrink-0`} />
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <span className={`${BLOCK} ml-auto h-12 w-3/4`} />
            <span className={`${BLOCK} h-4 w-2/3`} />
          </div>

          <span className={`${BLOCK} mt-auto h-20 w-full`} />
        </div>

        {/* Hidden on phones, where the builder shows one pane at a time and
            the chat rail above is the one that opens first. */}
        <div className="hidden min-h-0 min-w-0 flex-col gap-3 rounded-amb-panel border border-amb-border bg-amb-card p-4 md:flex">
          <div className="flex items-center gap-2">
            <span className={`${BLOCK} h-7 w-40`} />
            <span className={`${BLOCK} ml-auto h-7 w-24`} />
          </div>
          <span className={`${BLOCK} min-h-0 flex-1`} />
        </div>
      </div>

      <span className="sr-only" role="status">
        Opening this project…
      </span>
    </div>
  );
}
