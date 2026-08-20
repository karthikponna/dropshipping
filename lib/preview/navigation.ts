/**
 * Route changes travelling out of the preview iframe.
 *
 * The generated shop is two routes, but the Sandpack sandbox renders exactly one
 * of them: the adapter maps a single `app/page.tsx` onto the sandbox root, and
 * the two page types of a project are separate trees that both claim that path.
 * Putting a real router in the sandbox would mean adapting both trees on every
 * stream tick, resolving the path collisions the export already has to resolve,
 * and booting twice the code — for what is a viewing convenience.
 *
 * So the sandbox does not navigate. It intercepts clicks on in-site anchors and
 * asks the panel outside to switch which route it is previewing, which is the
 * same thing from the visitor's side and costs one message listener.
 *
 * The message is trusted only as far as it needs to be: the sandbox runs on an
 * opaque origin, so `event.origin` cannot be checked, and the payload therefore
 * carries no data beyond an href that is resolved against a fixed route table.
 * The worst a forged message can do is change which of two local trees is on
 * screen.
 */

import { pageTypeForHref } from "@/lib/framework/routes";
import type { PageType } from "@/lib/types";

/** `postMessage` discriminator. Namespaced: Sandpack posts plenty of its own. */
export const PREVIEW_NAVIGATE_MESSAGE = "dropshipping:preview-navigate";

export interface PreviewNavigateMessage {
  type: typeof PREVIEW_NAVIGATE_MESSAGE;
  /** The `href` attribute as written in the generated markup. */
  href: string;
}

export function isPreviewNavigateMessage(data: unknown): data is PreviewNavigateMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; href?: unknown };
  return candidate.type === PREVIEW_NAVIGATE_MESSAGE && typeof candidate.href === "string";
}

/**
 * The route a `message` payload asks for, or null for anything that is not a
 * navigation request to a route this shop has.
 */
export function previewNavigationTarget(data: unknown): PageType | null {
  if (!isPreviewNavigateMessage(data)) return null;
  return pageTypeForHref(data.href);
}
