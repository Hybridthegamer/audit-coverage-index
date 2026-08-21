"use client";

import { useEffect, useRef } from "react";

/**
 * Film grain — animated luminance noise at 5.5% over the whole viewport
 * (skill Law #9: the grain is on every page). A fixed, pointer-transparent
 * canvas so it never intercepts clicks or the custom cursor.
 *
 * Performance is the whole design here. The first version generated noise for
 * every viewport pixel on every animation frame: at 1517x754 that is ~1.14M
 * pixels, ~4.5M typed-array writes, measured at 77ms per frame — a 13fps
 * ceiling with the main thread pinned at 100%. That did not merely look bad,
 * it starved IntersectionObserver callbacks, so <Reveal> never fired and every
 * page rendered permanently blank.
 *
 * Instead we generate a small TILE x TILE square of real per-pixel noise and
 * repeat it across the canvas with a pattern fill. The noise stays 1:1 — it is
 * never stretched, so the grain is exactly as fine as before — but the JS cost
 * drops to 128*128 pixels (~0.5ms), and the repeat itself is a single native
 * fillRect. Throttling to GRAIN_FPS then keeps the flicker filmic rather than
 * frantic and leaves the main thread almost entirely free.
 *
 * Under `prefers-reduced-motion` it paints a single static frame instead of
 * looping — the texture stays, the flicker stops.
 */

/** Edge of the noise tile, in real pixels. Repeated, never scaled. */
const TILE = 128;

/** Grain redraws per second. Film grain reads correctly well below 60. */
const GRAIN_FPS = 12;

export function GrainOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Offscreen tile holding the only pixels we actually compute.
    const tile = document.createElement("canvas");
    tile.width = TILE;
    tile.height = TILE;
    const tileCtx = tile.getContext("2d");
    if (!tileCtx) return;

    const image = tileCtx.createImageData(TILE, TILE);
    const data = image.data;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animId = 0;
    let lastPaint = 0;

    const paint = () => {
      if (canvas.width === 0 || canvas.height === 0) return;

      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      tileCtx.putImageData(image, 0, 0);

      const pattern = ctx.createPattern(tile, "repeat");
      if (!pattern) return;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const loop = (now: number) => {
      animId = requestAnimationFrame(loop);
      if (now - lastPaint < 1000 / GRAIN_FPS) return;
      lastPaint = now;
      paint();
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      paint(); // repaint immediately at the new size
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="bam-grain" aria-hidden="true" />;
}
