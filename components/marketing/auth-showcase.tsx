import { AuthCanvas } from "./auth-canvas";
import { CornerFrame } from "./frame";

/**
 * The panel beside the login card: a brand-blue field of halftone dots that
 * lights up under the cursor. No copy — the form says what the page is for.
 *
 * Hidden below `lg`. On a narrow screen it would push the form below the fold,
 * and it is decoration — there is nothing in here a user needs.
 */
export function AuthShowcase() {
  return (
    <CornerFrame className="relative hidden min-h-[560px] flex-1 p-2.5 lg:block">
      {/* Also the pointer target: `AuthCanvas` listens on its parent so the
          bloom tracks across the whole panel, not just the canvas box. */}
      <div className="relative h-full overflow-hidden bg-sm-blue">
        <AuthCanvas className="absolute inset-0 block h-full w-full" />
      </div>
    </CornerFrame>
  );
}
