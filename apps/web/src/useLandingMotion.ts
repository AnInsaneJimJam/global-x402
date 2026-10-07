import { useEffect, useState } from "react";
import type { RefObject } from "react";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useLandingMotion(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const node = root.current;
    if (!node || !enabled) return;
    const animations = new Set<Animation>();
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal.unobserve(entry.target);
          if (entry.target.hasAttribute("data-revealed")) continue;
          entry.target.setAttribute("data-revealed", "");
          const siblings = entry.target.parentElement?.classList.contains(
            "hero-copy",
          )
            ? [...entry.target.parentElement.children]
            : [];
          const animation = entry.target.animate(
            [
              { opacity: 0, transform: "translateY(22px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            {
              duration: 650,
              delay: Math.max(0, siblings.indexOf(entry.target)) * 70,
              easing: "cubic-bezier(.22,1,.36,1)",
              fill: "backwards",
            },
          );
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        }
      },
      { threshold: 0.12 },
    );
    node
      .querySelectorAll(
        ".hero-copy > *, .protocol-strip-inner, .section-heading, .role-grid, .workflow-intro, .workflow-step, .closing-panel",
      )
      .forEach((element) => reveal.observe(element));

    const art = node.querySelector<HTMLElement>(".hero-art");
    let pointerFrame = 0;
    const reset = () => {
      cancelAnimationFrame(pointerFrame);
      art?.style.removeProperty("--tilt-x");
      art?.style.removeProperty("--tilt-y");
    };
    const tilt = (event: PointerEvent) => {
      if (!art || event.pointerType !== "mouse") return;
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        const bounds = art.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        art.style.setProperty("--tilt-x", `${-y * 12}deg`);
        art.style.setProperty("--tilt-y", `${x * 16}deg`);
      });
    };
    art?.addEventListener("pointermove", tilt);
    art?.addEventListener("pointerleave", reset);
    return () => {
      reveal.disconnect();
      animations.forEach((animation) => animation.cancel());
      reset();
      art?.removeEventListener("pointermove", tilt);
      art?.removeEventListener("pointerleave", reset);
    };
  }, [root, enabled]);
}
