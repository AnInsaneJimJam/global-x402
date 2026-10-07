import { useEffect, useRef } from "react";

// Animate only while visible; reduced-motion and the page control pass animated=false.
export function DotField({ animated = false }: { animated?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const savedPhase = useRef(0);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    let phase = savedPhase.current;
    let visible = false;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (let y = 0; y < height; y += 6) {
        for (let x = 0; x < width; x += 6) {
          const nx = x / width,
            ny = y / height;
          const wave =
            Math.sin(nx * 9 + Math.sin(ny * 7 + phase * 0.5) * 2.1 + phase) +
            Math.cos(ny * 10 - nx * 4 - phase * 0.7) +
            Math.sin(nx * 15 + ny * 6 + phase * 0.4) * 0.45;
          const density = Math.max(0, Math.min(1, (wave + 0.4) / 2));
          const fade = 0.18 + nx * 0.64;
          if (density > 0.13) {
            ctx.fillStyle = `rgba(215,215,215,${density * fade * 0.82})`;
            const size = density > 0.7 ? 1.5 : 1;
            ctx.fillRect(x, y, size, size);
          }
        }
      }
    };
    const resize = () => {
      const { width, height } = node.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      node.width = width * ratio;
      node.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const tick = (now: number) => {
      // Cap canvas work at 25fps; CSS handles the smooth card movement separately.
      if (now - lastTime >= 40) {
        phase += lastTime ? Math.min(now - lastTime, 80) * 0.00016 : 0;
        lastTime = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (animated && visible && !document.hidden)
        frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(() => {
      ({ width, height } = node.getBoundingClientRect());
      resize();
      draw();
    });
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(node);
    visibility.observe(node);
    document.addEventListener("visibilitychange", sync);
    return () => {
      savedPhase.current = phase;
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [animated]);
  return <canvas ref={canvas} className="dot-field" aria-hidden="true" />;
}
