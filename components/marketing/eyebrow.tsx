import { cx } from "./cx";

const EYEBROW = "font-sm-mono text-[11px] leading-none font-medium tracking-[0.14em] uppercase";
const RAIL = "font-sm-mono text-[10.5px] leading-none font-medium tracking-[0.18em] uppercase";

/**
 * Numbered micro-label — `01 · DESCRIBE`. Blue by default; `tone="dim"` for the
 * quieter side of a comparison pair.
 */
export function Eyebrow({
  index,
  children,
  marker = false,
  tone = "accent",
  className,
}: {
  /** Zero-padded automatically: `1` renders as `01 ·`. */
  index?: number;
  children: React.ReactNode;
  /** Leading 6px solid square. */
  marker?: boolean;
  tone?: "accent" | "dim" | "onBlue";
  className?: string;
}) {
  const toneClass =
    tone === "accent" ? "text-sm-blue" : tone === "dim" ? "text-sm-text-dim" : "text-white/70";

  return (
    <span className={cx(EYEBROW, toneClass, "inline-flex items-center gap-2", className)}>
      {marker ? (
        <span
          aria-hidden="true"
          className={cx("h-[6px] w-[6px] shrink-0", tone === "onBlue" ? "bg-white" : "bg-sm-blue")}
        />
      ) : null}
      {typeof index === "number" ? (
        <span>
          {String(index).padStart(2, "0")}
          <span className="mx-[6px] opacity-60">·</span>
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * The section rail: left label `⟩ HOW IT WORKS`, right `[n/n]` counter, closed
 * by a dashed hairline.
 */
export function SectionRail({
  label,
  index,
  total,
}: {
  label: string;
  index: number;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-sm-border-dashed py-3">
      <span className={cx(RAIL, "text-sm-text-muted")}>
        <span className="mr-2 text-sm-blue">⟩</span>
        {label}
      </span>
      <span className={cx(RAIL, "text-sm-text-muted")}>{`[${index}/${total}]`}</span>
    </div>
  );
}

/** Mono caption used under stats and beside file paths. */
export function MonoLabel({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <span id={id} className={cx(RAIL, "text-sm-text-dim", className)}>
      {children}
    </span>
  );
}
