/**
 * 16px stroke icons drawn inline — the console ships no icon dependency. Every
 * glyph inherits `currentColor` so nav rows recolor with their text utility.
 */

import { LogoMark } from "@/components/brand/logo-mark";

interface IconProps {
  className?: string;
}

function Glyph({
  className = "h-4 w-4",
  children,
}: IconProps & { children: React.ReactNode }) {
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

/** The shared brand mark, so the rail matches the marketing site exactly. */
export function BrandMark({ className = "h-6 w-6" }: IconProps) {
  return <LogoMark className={className} />;
}

export function HomeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5Z" />
    </Glyph>
  );
}

export function PagesIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9h17M9 9v11" />
    </Glyph>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </Glyph>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8 6 12l4 4M6 12h8" />
    </Glyph>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Glyph>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Glyph>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Glyph>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Glyph>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m9 6 6 6-6 6" />
    </Glyph>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Glyph>
  );
}

export function LayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M12 9.5V20" />
    </Glyph>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12.6 3.6H19a1.4 1.4 0 0 1 1.4 1.4v6.4a2 2 0 0 1-.6 1.4l-6.6 6.6a1.4 1.4 0 0 1-2 0l-6.4-6.4a1.4 1.4 0 0 1 0-2l6.6-6.6a2 2 0 0 1 1.2-.8Z" />
      <circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
      <path d="m14.5 5.5 4 4" />
    </Glyph>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </Glyph>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="16" r="3.5" />
      <path d="m10.6 13.4 8-8M16.5 8l2 2M14 10.5l2 2" />
    </Glyph>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 4l1.6 4.6L18 10.2l-4.4 1.6L12 16.4l-1.6-4.6L6 10.2l4.4-1.6L12 4Z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </Glyph>
  );
}
