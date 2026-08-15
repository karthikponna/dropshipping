import Link from "next/link";

import { cx } from "./cx";

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cx("h-[13px] w-[13px]", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
    </svg>
  );
}

type SplitSize = "default" | "nav";
type SplitTone = "blue" | "white";

const SPLIT_SHELL =
  "group inline-flex items-stretch overflow-hidden font-sm-body font-medium tracking-[-0.005em] transition-[background-color,border-color,transform] duration-[180ms] ease-sm-out-strong active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100";

const SPLIT_TONE: Record<SplitTone, string> = {
  blue: "border border-sm-blue bg-sm-blue text-white hover:border-sm-blue-hover hover:bg-sm-blue-hover",
  white: "border border-white bg-white text-sm-blue hover:border-sm-blue-tint hover:bg-sm-blue-tint",
};

const SPLIT_DIVIDER: Record<SplitTone, string> = {
  blue: "border-white/[0.18]",
  white: "border-sm-blue/20",
};

const SPLIT_SIZE: Record<SplitSize, { shell: string; label: string; arrow: string }> = {
  default: { shell: "h-11", label: "px-5 text-[14.5px]", arrow: "w-11" },
  nav: { shell: "h-10", label: "px-4 text-[14px]", arrow: "w-9" },
};

const ARROW_CELL =
  "inline-flex shrink-0 items-center justify-center transition-transform duration-200 ease-sm-out-strong group-hover:translate-x-[2px] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0";

/**
 * The primary CTA: one flat rectangle split into a label cell and a square
 * arrow cell by a translucent internal hairline. This shape — not a plain
 * rectangle — is the system's primary button.
 */
export function SplitLink({
  href,
  label,
  size = "default",
  tone = "blue",
  className,
}: {
  href: string;
  label: string;
  size?: SplitSize;
  tone?: SplitTone;
  className?: string;
}) {
  const sizing = SPLIT_SIZE[size];

  return (
    <Link
      href={href}
      className={cx(SPLIT_SHELL, SPLIT_TONE[tone], sizing.shell, className)}
    >
      <span
        className={cx(
          "inline-flex flex-1 items-center justify-center border-r whitespace-nowrap",
          SPLIT_DIVIDER[tone],
          sizing.label,
        )}
      >
        {label}
      </span>
      <span className={cx(ARROW_CELL, sizing.arrow)}>
        <ArrowRight />
      </span>
    </Link>
  );
}

/**
 * Form submit in the same split shape. While the action is in flight the label
 * swaps and the arrow cell becomes a pulsing square — nothing spins.
 */
export function SplitSubmit({
  label,
  pendingLabel,
  pending,
  className,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cx(
        SPLIT_SHELL,
        SPLIT_TONE.blue,
        SPLIT_SIZE.default.shell,
        "w-full disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
    >
      <span
        className={cx(
          "inline-flex flex-1 items-center justify-center border-r whitespace-nowrap",
          SPLIT_DIVIDER.blue,
          SPLIT_SIZE.default.label,
        )}
      >
        {pending ? pendingLabel : label}
      </span>
      <span className={cx(ARROW_CELL, SPLIT_SIZE.default.arrow)}>
        {pending ? (
          <span aria-hidden="true" className="h-[7px] w-[7px] animate-pulse bg-white" />
        ) : (
          <ArrowRight />
        )}
      </span>
    </button>
  );
}

/** Neutral paper button used beside the primary CTA. */
export function SecondaryLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex h-11 items-center justify-center gap-2 border border-sm-border-light bg-sm-paper px-5 font-sm-body text-[14.5px] font-medium tracking-[-0.005em] text-sm-text transition-[background-color,border-color,transform] duration-[180ms] ease-sm-out-strong hover:border-sm-text hover:bg-sm-bg-alt active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Bordered ghost link — the nav `Login`. */
export function GhostLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex h-10 items-center justify-center border border-sm-border-light bg-white px-4 font-sm-body text-[14px] font-medium tracking-[-0.005em] text-sm-text transition-[background-color,border-color] duration-[180ms] ease-sm-out-strong hover:border-sm-blue hover:bg-sm-blue-tint hover:text-sm-blue motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </Link>
  );
}
