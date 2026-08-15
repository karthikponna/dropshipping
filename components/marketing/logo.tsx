import { LogoMark } from "@/components/brand/logo-mark";

import { cx } from "./cx";

export { LogoMark };

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
