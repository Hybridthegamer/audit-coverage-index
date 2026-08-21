"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Stagger before the fadeUp plays, in ms. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Scroll-reveal primitive (skill Step 6 / Law #13) — CSS keyframes + a single
 * IntersectionObserver, no animation library.
 *
 * It renders its wrapper already in the fadeUp `from` state (opacity 0,
 * translated down) so there is no visible → hidden flash on first paint, then
 * plays `bam-fadeUp` once the element scrolls into view and stops observing it.
 *
 * Two escape hatches keep content readable when animation is wrong or absent:
 *   · prefers-reduced-motion / no IntersectionObserver → shown immediately.
 *   · JS off entirely → the layout <noscript> + globals.css force [data-reveal]
 *     visible, so nothing depends on this effect ever running.
 *
 * Dense surfaces wrap the whole table in ONE <Reveal>, never one per row —
 * 200+ staggered rows would be motion sickness, not editorial.
 */
export function Reveal({ children, delay = 0, className, style }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }

    let timer = 0;

    const show = () => {
      el.style.animation = "bam-fadeUp 0.7s ease-out forwards";
    };

    /**
     * Failsafe. Hiding content behind an observer means any reason the callback
     * does not arrive leaves the page permanently blank — and that is not
     * hypothetical: an over-eager grain loop once starved the main thread badly
     * enough that no reveal ever fired and the whole site rendered empty.
     * Other routes to the same outcome are a tall element that never reaches
     * the threshold, or a fast scroll past it before hydration registers the
     * observer. So content reveals on intersection OR after this deadline,
     * whichever comes first. Worst case the animation plays unseen; the page is
     * never invisible.
     */
    const failsafe = window.setTimeout(show, 1600 + delay);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          window.clearTimeout(failsafe);
          timer = window.setTimeout(show, delay);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(failsafe);
      observer.disconnect();
    };
  }, [delay]);

  return (
    <div
      ref={ref}
      data-reveal
      className={className}
      style={{ opacity: 0, transform: "translateY(28px)", ...style }}
    >
      {children}
    </div>
  );
}
