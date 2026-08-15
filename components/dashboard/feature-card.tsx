import { cx } from "@/lib/dashboard/format";

interface FeatureCardProps {
  children: React.ReactNode;
  className?: string;
}

/** 28px radius, white, 20px padding, the six-layer shadow. */
export function FeatureCard({ children, className }: FeatureCardProps) {
  return (
    <section
      className={cx(
        "relative flex flex-col overflow-hidden rounded-amb-feature bg-amb-card p-5 shadow-amb-feature sm:min-h-[394px]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function FeatureCardEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] font-medium text-amb-muted-foreground">{children}</p>;
}

export function FeatureCardHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-1 text-[30px] leading-[1.12] font-semibold tracking-[-0.035em] text-amb-foreground">
      {children}
    </h2>
  );
}
