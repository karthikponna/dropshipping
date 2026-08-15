/**
 * Inline 16px icons for the preview panel. The project ships no icon library,
 * and the Amboras console draws its chrome with thin 1.5px strokes, so these
 * are hand-rolled and inherit `currentColor`.
 */

import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DesktopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="12" rx="1.5" width="18" x="3" y="4" />
      <path d="M8 20h8M12 16v4" />
    </Icon>
  );
}

export function TabletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="18" rx="2" width="13" x="5.5" y="3" />
      <path d="M11 18.5h2" />
    </Icon>
  );
}

export function MobileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="18" rx="2.5" width="10" x="7" y="3" />
      <path d="M11 18.5h2" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="12" rx="2" width="12" x="9" y="9" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Icon>
  );
}

export function LayoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M3 9h18M9 20V9" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5 2.8 20h18.4z" />
      <path d="M12 10v4.5M12 17.6h.01" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </Icon>
  );
}
