"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes a popover on Escape, or on a pointer press anywhere outside it.
 *
 * Attach the returned ref to the element that wraps both the trigger and the
 * panel — including the trigger matters, otherwise clicking it while the panel
 * is open dismisses and reopens in the same gesture, and the menu never closes.
 *
 * Listening on `pointerdown` rather than `click` closes the panel as the press
 * begins, which is what makes dismissing feel immediate rather than deferred to
 * mouseup.
 */
export function useDismiss<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  // Held in a ref so the listeners are bound once per open, rather than
  // re-bound on every render of the component that owns the handler.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onDismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismissRef.current();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return ref;
}
