"use client";

import { useEffect, useRef } from "react";

/**
 * Film grain — animated luminance noise at 5.5% over the whole viewport
 * (skill Law #9: the grain is on every page). A fixed, pointer-transparent
 * canvas so it never intercepts clicks or the custom cursor.
 *
 * Under `prefers-reduced-motion` it paints a single static frame instead of
 * looping requestAnimationFrame — the texture stays, the flicker stops.
 */
export function GrainOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animId = 0;

    const draw = () => {
      const { width: w, height: h } = canvas;
      if (w === 0 || h === 0) return;
      const img = ctx.createImageData(w, h);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (!reduce) animId = requestAnimationFrame(draw);
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (reduce) draw(); // repaint the static frame at the new size
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="bam-grain" aria-hidden="true" />;
}
