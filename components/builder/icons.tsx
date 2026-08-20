/**
 * The handful of glyphs the builder needs on top of the console set in
 * components/dashboard/icons.tsx. Same 24-box, same 1.7 stroke, same
 * `currentColor` inheritance — import the shared ones from there rather than
 * redrawing them here.
 */

interface IconProps {
  className?: string;
}

function Glyph({ className = "h-4 w-4", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Version history. */
export function HistoryIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V10h5" />
      <path d="M12 8v4.4l3 1.8" />
    </Glyph>
  );
}

/** The model doing the writing. */
export function SparkIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
      <path d="M18.5 3.5v3M20 5h-3" />
    </Glyph>
  );
}

/** Restore an earlier version. */
export function RestoreIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 12a8 8 0 1 1 3 6.2" />
      <path d="M4 16.5V11h5.5" />
    </Glyph>
  );
}

/** Stop the running generation. */
export function StopIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 4.5 3.2 19.5h17.6L12 4.5Z" />
      <path d="M12 10v4" />
      <path d="M12 16.6h.01" />
    </Glyph>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
      <path d="M13.75 3.75V8.5h4.5" />
    </Glyph>
  );
}

/**
 * Something recalled from the memory graph — three connected nodes, since what
 * is being surfaced is a relationship rather than a stored value.
 */
export function MemoryIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="17" r="2.4" />
      <circle cx="18" cy="17" r="2.4" />
      <circle cx="12" cy="6" r="2.4" />
      <path d="M10.4 7.9 7.6 15.1M13.6 7.9l2.8 7.2M8.4 17h7.2" />
    </Glyph>
  );
}

/** Chat rail on mobile. */
export function ChatIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20 15.5a2 2 0 0 1-2 2H8.5L4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9.5Z" />
      <path d="M8.5 9.5h7M8.5 13h4" />
    </Glyph>
  );
}

/** Preview pane on mobile. */
export function ScreenIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </Glyph>
  );
}

/** Opens the page switcher menu. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Glyph>
  );
}

/** Attach a photo to the next generation. */
export function ImagePlusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20 13.5V6.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7.5" />
      <path d="M4.5 16.5 9 12l3.5 3.5" />
      <circle cx="14.75" cy="9.25" r="1.25" />
      <path d="M18 16v5M15.5 18.5h5" />
    </Glyph>
  );
}

/** Remove an attached photo. */
export function CloseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Glyph>
  );
}
