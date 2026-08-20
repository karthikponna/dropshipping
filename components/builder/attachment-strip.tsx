"use client";

import { useRef } from "react";

import { IMAGE_ACCEPT } from "@/lib/uploads/images";
import { MAX_ATTACHMENTS, type ImageAsset } from "@/lib/types";

import { CloseIcon, ImagePlusIcon } from "./icons";

/**
 * The two visible halves of attaching a photo: the thumbnails, which sit above
 * the textarea, and the button, which sits beside send. They are separate
 * components because they live in different rows of the composer; the state
 * they share is in use-attachments.ts.
 */

export interface AttachmentStripProps {
  items: readonly ImageAsset[];
  /** Placeholder tiles for uploads still in flight. */
  pending: number;
  onRemove: (asset: ImageAsset) => void;
}

/** Thumbnails of what will be sent with the next message. */
export function AttachmentStrip({ items, pending, onRemove }: AttachmentStripProps) {
  if (items.length === 0 && pending === 0) return null;

  return (
    <ul aria-label="Attached images" className="mb-2 flex flex-wrap gap-1.5">
      {items.map((asset) => (
        <li className="group relative" key={asset.id}>
          {/* eslint-disable-next-line @next/next/no-img-element -- an object in a
              bucket, unknown at build time and not worth an optimiser round trip. */}
          <img
            alt={asset.name}
            className="h-14 w-14 rounded-amb-row border border-amb-border object-cover"
            height={56}
            src={asset.url}
            title={asset.name}
            width={56}
          />
          <button
            aria-label={`Remove ${asset.name}`}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-amb-border bg-amb-background text-amb-muted-foreground opacity-0 shadow-amb-xs transition-opacity hover:text-amb-foreground focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => onRemove(asset)}
            type="button"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </li>
      ))}

      {Array.from({ length: pending }, (_, index) => (
        <li
          className="flex h-14 w-14 items-center justify-center rounded-amb-row border border-dashed border-amb-border"
          key={`pending-${index}`}
        >
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-amb-border border-t-amb-foreground" />
          <span className="sr-only">Uploading</span>
        </li>
      ))}
    </ul>
  );
}

export interface AttachButtonProps {
  onPick: (files: readonly File[]) => void;
  /** True once the message is carrying as many images as it may. */
  full: boolean;
  disabled: boolean;
}

/** Opens the file picker. The input itself is hidden but focusable-by-click. */
export function AttachButton({ onPick, full, disabled }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        accept={IMAGE_ACCEPT}
        className="sr-only"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared before the callback so picking the same file twice in a row
          // still fires a change event.
          event.target.value = "";
          if (files.length > 0) onPick(files);
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <button
        aria-label="Attach product photos"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-amb-muted-foreground transition-colors hover:bg-amb-secondary hover:text-amb-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-amb-muted-foreground"
        disabled={disabled || full}
        onClick={() => inputRef.current?.click()}
        title={full ? `Up to ${MAX_ATTACHMENTS} images per message` : "Attach product photos"}
        type="button"
      >
        <ImagePlusIcon className="h-4 w-4" />
      </button>
    </>
  );
}
