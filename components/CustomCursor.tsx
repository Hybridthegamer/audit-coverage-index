"use client";

import { useEffect } from "react";

/**
 * Custom cursor — an 8px cream dot with mix-blend-mode: difference, so it stays
 * visible over any ground. Desktop only: on coarse/touch pointers we tag the
 * body `.is-touch` (which restores the native cursor via globals.css) and bail.
 *
 * The dot grows over interactive targets (a/button/label/select) and shrinks a
 * little over text inputs. Renders nothing itself — it manages one DOM node.
 */
export function CustomCursor() {
  useEffect(() => {
    const coarse =
      "ontouchstart" in window ||
      window.matchMedia("(pointer: coarse)").matches;
    if (coarse) {
      document.body.classList.add("is-touch");
      return;
    }

    const cursor = document.createElement("div");
    cursor.id = "bam-cursor";
    document.body.appendChild(cursor);

    const HOVER = 'a, button, [role="button"], label, select';
    const INPUT = "input, textarea";

    const onMove = (e: MouseEvent) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      cursor.classList.remove("hidden");
    };
    const onLeave = () => cursor.classList.add("hidden");
    const onEnter = () => cursor.classList.remove("hidden");

    const onOver = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (t.closest(HOVER)) cursor.classList.add("hovered");
      else if (t.closest(INPUT)) cursor.classList.add("on-input");
    };
    const onOut = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest(`${HOVER}, ${INPUT}`)) {
        cursor.classList.remove("hovered");
        cursor.classList.remove("on-input");
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseenter", onEnter);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseenter", onEnter);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      cursor.remove();
    };
  }, []);

  return null;
}
