"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  UploadError,
  deleteImage,
  roomForAttachments,
  uploadImage,
} from "@/lib/uploads/images";
import { MAX_ATTACHMENTS, type ImageAsset } from "@/lib/types";

/**
 * The photos attached to the next generation, for one page of the shop.
 *
 * Files upload the moment they are picked rather than at submit time, so by the
 * time the user presses send the images are already in the bucket and the run
 * starts immediately. The cost is that an abandoned draft can leave objects
 * behind — removing a thumbnail deletes its object, closing the tab does not.
 * That is the right trade in a builder where the slow part is the model, and
 * the alternative is a spinner between pressing send and anything happening.
 */

export interface Attachments {
  items: readonly ImageAsset[];
  /** Uploads in flight, rendered as placeholder tiles. */
  pending: number;
  error: string | null;
  /** True while anything is uploading — the composer holds send until it clears. */
  busy: boolean;
  full: boolean;
  add: (files: readonly File[]) => void;
  remove: (asset: ImageAsset) => void;
  /** Empties the tray without deleting the objects — used after a send. */
  clear: () => void;
}

export function useAttachments(projectId: string): Attachments {
  const [items, setItems] = useState<readonly ImageAsset[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Uploads land one at a time and each appends to a list that may have grown
  // since it started, so the append reads the current value rather than the one
  // its closure captured.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const add = useCallback(
    (files: readonly File[]): void => {
      const room = roomForAttachments(itemsRef.current.length + pending);
      if (room === 0) {
        setError(`Up to ${MAX_ATTACHMENTS} images per message.`);
        return;
      }

      const accepted = files.slice(0, room);
      setError(
        files.length > room
          ? `Added the first ${room} — ${MAX_ATTACHMENTS} images is the limit for one message.`
          : null,
      );
      setPending((count) => count + accepted.length);

      void (async () => {
        // Sequentially, appending as each lands: one oversized photo should not
        // hold up the others, and one failure should not discard the selection.
        for (const file of accepted) {
          try {
            const asset = await uploadImage(file, { projectId });
            itemsRef.current = [...itemsRef.current, asset];
            setItems(itemsRef.current);
          } catch (failure) {
            setError(
              failure instanceof UploadError
                ? failure.message
                : `${file.name} could not be uploaded.`,
            );
          } finally {
            setPending((count) => Math.max(0, count - 1));
          }
        }
      })();
    },
    [pending, projectId],
  );

  const remove = useCallback((asset: ImageAsset): void => {
    itemsRef.current = itemsRef.current.filter((item) => item.id !== asset.id);
    setItems(itemsRef.current);
    setError(null);
    void deleteImage(asset);
  }, []);

  const clear = useCallback((): void => {
    itemsRef.current = [];
    setItems(itemsRef.current);
    setError(null);
  }, []);

  return {
    items,
    pending,
    error,
    busy: pending > 0,
    full: items.length + pending >= MAX_ATTACHMENTS,
    add,
    remove,
    clear,
  };
}
