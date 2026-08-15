/**
 * The DropShipping mark: two blueprint brackets closing around a solid core —
 * a page frame being drawn.
 *
 * Deliberately design-system neutral so both scopes can render the same mark.
 * The brackets take `currentColor`, inheriting the near-black of whichever
 * scope draws them, and the accent square carries the brand blue as a literal
 * because `--color-blue` is only defined inside `.sm-scope`.
 */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 1h9v3H4v6H1z" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
      <path d="M23 23h-9v-3h6v-6h3z" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
      <path d="M9 9h6v6H9z" fill="#0562EF" />
    </svg>
  );
}
