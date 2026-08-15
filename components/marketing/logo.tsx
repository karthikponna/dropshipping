import { cx } from "./cx";

/**
 * The mark: two blueprint brackets around a solid blue core — a page frame
 * being drawn. Sharp corners, `currentColor` outline, one accent square, and
 * the 0.5 stroke the design system uses for optical weight.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("h-6 w-6 shrink-0", className)}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 1h9v3H4v6H1z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
      />
      <path
        d="M23 23h-9v-3h6v-6h3z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
      />
      <path d="M9 9h6v6H9z" fill="var(--color-blue)" />
    </svg>
  );
}

/** Mark plus the lowercase wordmark, set in the heading face at weight 500. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-sm-text", className)}>
      <LogoMark />
      <span className="font-sm-heading text-[17px] leading-none font-medium tracking-[-0.03em]">
        dropshipping
      </span>
    </span>
  );
}
