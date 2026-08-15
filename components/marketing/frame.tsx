import { cx } from "./cx";

const TICK = "pointer-events-none absolute z-[1] h-[11px] w-[11px]";

/**
 * Blueprint wrapper: a 1px dashed border with blue L-ticks at each corner.
 * Ticks are real elements rather than pseudo-elements so they survive the
 * `border-radius: 0` reset and stay inspectable.
 */
export function CornerFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("relative border border-dashed border-sm-border-dashed", className)}>
      <span aria-hidden="true" className={cx(TICK, "-top-px -left-px border-t border-l border-sm-tick")} />
      <span aria-hidden="true" className={cx(TICK, "-top-px -right-px border-t border-r border-sm-tick")} />
      <span aria-hidden="true" className={cx(TICK, "-bottom-px -left-px border-b border-l border-sm-tick")} />
      <span aria-hidden="true" className={cx(TICK, "-bottom-px -right-px border-b border-r border-sm-tick")} />
      {children}
    </div>
  );
}

/**
 * `+` crosshair for interior grid intersections. It centres itself on the point
 * given by the positioning utilities in `className`, which must also carry the
 * breakpoint at which that intersection actually exists.
 */
export function Crosshair({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute z-[1] h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2",
        className,
      )}
    >
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-sm-tick" />
      <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-sm-tick" />
    </span>
  );
}

const DOT_COLOR = {
  blue: "rgba(124, 183, 255, 0.35)",
  white: "rgba(255, 255, 255, 0.28)",
} as const;

const DOT_MASK = "radial-gradient(ellipse 85% 75% at 50% 50%, #000 30%, transparent 100%)";

/** Faint dot field, radially masked so it fades out at the edges. */
export function DotGrid({
  tone = "blue",
  className,
}: {
  tone?: keyof typeof DOT_COLOR;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx("pointer-events-none absolute inset-0 block", className)}
      style={{
        backgroundImage: `radial-gradient(circle, ${DOT_COLOR[tone]} 1px, transparent 1.4px)`,
        backgroundSize: "16px 16px",
        maskImage: DOT_MASK,
        WebkitMaskImage: DOT_MASK,
      }}
    />
  );
}
