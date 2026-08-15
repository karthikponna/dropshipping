import { cx } from "@/lib/dashboard/format";
import { PAGE_TYPE_LABELS, type PageType } from "@/lib/types";
import { LayoutIcon, TagIcon } from "./icons";

const ICONS: Record<PageType, (props: { className?: string }) => React.ReactElement> = {
  landing: LayoutIcon,
  product: TagIcon,
};

interface PageTypeBadgeProps {
  pageType: PageType;
  className?: string;
}

export function PageTypeBadge({ pageType, className }: PageTypeBadgeProps) {
  const Icon = ICONS[pageType];

  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-amb-border bg-amb-muted px-2.5 text-[12px] font-medium text-amb-muted-foreground",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {PAGE_TYPE_LABELS[pageType]}
    </span>
  );
}
