"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MAX_ATTACHMENTS, SHOP_ASSETS_BUCKET, type ImageAsset } from "@/lib/types";

/**
 * Getting a user's photo from their disk into both Claude's eyes and the
 * generated page's markup.
 *
 * Uploads go straight from the browser to Supabase Storage rather than through
 * a route handler. The browser client is already signed in, storage policies
 * scope writes to the uploader's own folder, and a 3MB photo never has to pass
 * through a serverless function with a body limit and a cold start.
 *
 * Every image is re-encoded before it leaves: see `downscale`.
 */

/**
 * Long-edge ceiling, in pixels.
 *
 * 1568 is the size Anthropic scales images down to internally, so anything
 * larger costs upload time and storage to buy nothing — and a phone photo is
 * routinely 4032px wide. It is still comfortably retina for a hero image.
 */
const MAX_EDGE = 1568;

/** WebP at this quality is visually clean and roughly a fifth of a raw JPEG. */
const QUALITY = 0.82;

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/** What a file input should offer, and what we re-check after picking. */
export const IMAGE_ACCEPT = ACCEPTED_TYPES.join(",");

/** Rejected before any work is done — the browser has to decode it first. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class UploadError extends Error {}

export interface UploadOptions {
  /** Scopes the object path, so a project's images are greppable in the bucket. */
  projectId: string;
  signal?: AbortSignal;
}

/**
 * Uploads one image and returns what the rest of the app needs to reference it.
 *
 * Throws `UploadError` with a sentence fit for the UI. Callers upload files one
 * at a time so a single bad file cannot take a whole selection down with it.
 */
export async function uploadImage(file: File, { projectId, signal }: UploadOptions): Promise<ImageAsset> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    throw new UploadError("Supabase is not configured, so images cannot be uploaded.");
  }

  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new UploadError(`${file.name} is not an image DropShipping can use.`);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new UploadError(`${file.name} is larger than 25MB.`);
  }

  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    throw new UploadError("Sign in again to upload images.");
  }

  const prepared = await downscale(file);
  if (signal?.aborted) throw new UploadError("Upload cancelled.");

  // The first segment must be the uploader's id: that is exactly what the
  // storage policy checks, so the path is the authorization.
  const path = `${data.user.id}/${projectId}/${crypto.randomUUID()}.${prepared.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(SHOP_ASSETS_BUCKET)
    .upload(path, prepared.blob, { contentType: prepared.mimeType, cacheControl: "31536000", upsert: false });

  if (uploadError) {
    throw new UploadError(
      /bucket/i.test(uploadError.message)
        ? "The shop-assets bucket is missing. Run supabase/migrations/0003_shop_assets.sql."
        : `${file.name} could not be uploaded: ${uploadError.message}`,
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(SHOP_ASSETS_BUCKET).getPublicUrl(path);

  return {
    id: crypto.randomUUID(),
    url: publicUrl,
    path,
    name: file.name,
    mimeType: prepared.mimeType,
    width: prepared.width,
    height: prepared.height,
    size: prepared.blob.size,
  };
}

/** Best-effort cleanup when a user removes an attachment before sending. */
export async function deleteImage(asset: ImageAsset): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  await supabase.storage.from(SHOP_ASSETS_BUCKET).remove([asset.path]).catch(() => undefined);
}

/** Trims a selection to what one turn is allowed to carry. */
export function roomForAttachments(current: number): number {
  return Math.max(0, MAX_ATTACHMENTS - current);
}

/* ─────────────────────────────── downscaling ────────────────────────────── */

interface PreparedImage {
  blob: Blob;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}

/**
 * Re-encodes an image to WebP within `MAX_EDGE`, and records its dimensions.
 *
 * Three things need this. Anthropic bills by pixel area and downsizes anything
 * bigger anyway; a phone photo takes several seconds to upload untouched over a
 * hotel connection; and the generated markup needs real `width`/`height`
 * attributes, which means somebody has to decode the image regardless.
 *
 * Animated GIFs are passed through untouched — a canvas would flatten them to
 * their first frame, and a broken animation is worse than a large file.
 */
async function downscale(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new UploadError(`${file.name} could not be read as an image.`);

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    if (file.type === "image/gif") {
      return { blob: file, mimeType: file.type, extension: "gif", width: bitmap.width, height: bitmap.height };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new UploadError("This browser could not process the image.");
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", QUALITY);
    });
    if (!blob) throw new UploadError(`${file.name} could not be converted.`);

    return { blob, mimeType: "image/webp", extension: "webp", width, height };
  } finally {
    bitmap.close();
  }
}
