"use client";

import { useEffect, useRef } from "react";

/**
 * The halftone panel beside the auth card.
 *
 * A grid of dots whose size and brightness track a field made of two things:
 * a few slow-drifting blobs, so the panel is alive before anyone touches it,
 * and the pointer, which pulls a bright bloom along with it. Nothing here is
 * an image — the whole panel is ~2.5k arcs redrawn per frame, which is cheaper
 * than it sounds and means it resizes to any panel without going soft.
 *
 * Canvas rather than 2,500 DOM nodes, and rather than a CSS mask: the dots
 * change radius, not just opacity, and that is the part that reads as depth.
 */

const SPACING = 14;
/** How far the pointer's influence reaches, in CSS pixels. */
const POINTER_RADIUS = 170;
/** Per-frame easing on the pointer, so a fast cursor drags the bloom behind it. */
const POINTER_EASE = 0.12;

const DOT_MIN_RADIUS = 0.55;
const DOT_MAX_RADIUS = 2.5;
const DOT_MIN_ALPHA = 0.1;
const DOT_MAX_ALPHA = 1;

/** Ambient blobs: phase, speed and extent of each drifting light source. */
const BLOBS = [
  { ox: 0.28, oy: 0.22, ax: 0.16, ay: 0.12, sx: 0.00021, sy: 0.00017, radius: 0.42 },
  { ox: 0.72, oy: 0.68, ax: 0.14, ay: 0.16, sx: -0.00016, sy: 0.00023, radius: 0.38 },
  { ox: 0.5, oy: 0.85, ax: 0.2, ay: 0.1, sx: 0.00027, sy: -0.00013, radius: 0.3 },
] as const;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 1 at the centre, 0 at the edge, with eased shoulders rather than a cone. */
function falloff(distanceSq: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = 1 - Math.min(1, distanceSq / (radius * radius));
  return t * t;
}

export function AuthCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let frame = 0;

    // Where the pointer is, and where the bloom has eased to. Kept apart so the
    // bloom can keep travelling for a moment after the pointer stops.
    const pointer = { x: 0, y: 0, strength: 0 };
    const eased = { x: 0, y: 0, strength: 0 };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Cap the backing store at 2x: past that the dots are smaller than the
      // pixels spent on them.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number): void => {
      // Below `lg` the panel is display:none, so the canvas measures zero. Let
      // the loop die rather than idle; the observer restarts it if it appears.
      if (width === 0 || height === 0) return;

      eased.x = lerp(eased.x, pointer.x, POINTER_EASE);
      eased.y = lerp(eased.y, pointer.y, POINTER_EASE);
      eased.strength = lerp(eased.strength, pointer.strength, POINTER_EASE);

      context.clearRect(0, 0, width, height);

      // Blob centres are resolved once per frame, not once per dot.
      const centres = BLOBS.map((blob) => ({
        x: (blob.ox + Math.cos(time * blob.sx) * blob.ax) * width,
        y: (blob.oy + Math.sin(time * blob.sy) * blob.ay) * height,
        radiusSq: (blob.radius * Math.max(width, height)) ** 2,
      }));

      const pointerActive = eased.strength > 0.01;

      for (let y = SPACING / 2; y < height; y += SPACING) {
        for (let x = SPACING / 2; x < width; x += SPACING) {
          let intensity = 0;

          for (const centre of centres) {
            const dx = x - centre.x;
            const dy = y - centre.y;
            const t = 1 - Math.min(1, (dx * dx + dy * dy) / centre.radiusSq);
            intensity += t * t * 0.55;
          }

          if (pointerActive) {
            const dx = x - eased.x;
            const dy = y - eased.y;
            intensity += falloff(dx * dx + dy * dy, POINTER_RADIUS) * eased.strength * 1.15;
          }

          if (intensity <= 0.015) continue;
          const level = Math.min(1, intensity);

          // Deep blue in the dim field, warming to white at the bright core, so
          // the pointer reads as light rather than as a bigger blue dot.
          const warmth = Math.max(0, level - 0.45) / 0.55;
          const red = Math.round(lerp(96, 255, warmth));
          const green = Math.round(lerp(160, 252, warmth));

          context.beginPath();
          context.arc(x, y, lerp(DOT_MIN_RADIUS, DOT_MAX_RADIUS, level), 0, Math.PI * 2);
          context.fillStyle = `rgba(${red}, ${green}, 255, ${lerp(DOT_MIN_ALPHA, DOT_MAX_ALPHA, level)})`;
          context.fill();
        }
      }

      frame = window.requestAnimationFrame(draw);
    };

    // A still field still has to be drawn once, and still follows the pointer —
    // reduced motion is about unrequested movement, not about being inert.
    const drawStatic = (): void => {
      draw(0);
      window.cancelAnimationFrame(frame);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.strength = 1;

      // The eased position starts at the pointer rather than at 0,0, or the
      // first move drags a bloom diagonally across the whole panel.
      if (eased.strength === 0) {
        eased.x = pointer.x;
        eased.y = pointer.y;
      }
      if (reduceMotion.matches) drawStatic();
    };

    const onPointerLeave = (): void => {
      pointer.strength = 0;
      if (reduceMotion.matches) drawStatic();
    };

    const start = (): void => {
      window.cancelAnimationFrame(frame);
      if (reduceMotion.matches) {
        drawStatic();
        return;
      }
      frame = window.requestAnimationFrame(draw);
    };

    const onResize = (): void => {
      resize();
      start();
    };

    // Nothing to animate for a tab nobody is looking at.
    const onVisibility = (): void => {
      if (document.hidden) window.cancelAnimationFrame(frame);
      else start();
    };

    resize();
    start();

    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);

    const parent = canvas.parentElement;
    parent?.addEventListener("pointermove", onPointerMove);
    parent?.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", start);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      parent?.removeEventListener("pointermove", onPointerMove);
      parent?.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", start);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
