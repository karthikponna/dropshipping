import type { DashboardMetrics } from "./data";
import { formatRelativeTime } from "./format";

interface MetricToplineProps {
  metrics: DashboardMetrics;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-amb-control px-2 pt-1 pb-[7px]">
      <span className="block text-[14px] font-normal text-amb-muted-foreground">{label}</span>
      <span className="block text-[16px] font-semibold text-amb-foreground">{value}</span>
    </div>
  );
}

/** The strip above the fold: label over value, no borders, no chrome. */
export function MetricTopline({ metrics }: MetricToplineProps) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="px-2 pt-1 pb-[7px] text-[14px] leading-5">
        <span className="block text-amb-foreground">Your workspace</span>
        <span className="block text-amb-muted-foreground">All time</span>
      </div>
      <Metric label="Pages" value={String(metrics.projectCount)} />
      <Metric label="Generations" value={String(metrics.generationCount)} />
      <Metric
        label="Last activity"
        value={metrics.lastActivityAt ? formatRelativeTime(metrics.lastActivityAt) : "—"}
      />
    </div>
  );
}
