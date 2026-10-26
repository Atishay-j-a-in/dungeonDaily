import { useEffect, useRef } from "react";

// Jelly hero orb: a fluid blob built from SVG shapes pushed through a gooey
// filter (blur + alpha threshold), driven by spring physics. The body leans
// toward the cursor, a droplet reaches out and merges back through surface
// tension, an orbiting satellite constantly splits and rejoins, and a poke
// recoils with elastic squash. Reduced motion renders one static frame.

interface JellyOrbProps {
  reduced?: boolean;
  label: string;
}

const CX = 80;
const CY = 80;
const BODY_R = 40;
const STEP = 1 / 60;

export function JellyOrb({ reduced = false, label }: JellyOrbProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<SVGCircleElement | null>(null);
  const dropRef = useRef<SVGCircleElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const shineRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    const wrap = wrapRef.current;
    const body = bodyRef.current;
    const drop = dropRef.current;
    const group = groupRef.current;
    const shine = shineRef.current;
    if (!wrap || !body || !drop || !group || !shine) return;

    const ptr = { x: CX, y: CY, active: false };
    const b = { x: CX, y: CY, vx: 0, vy: 0 };
    const d = { x: CX, y: CY, vx: 0, vy: 0, r: 14 };
    const rad = { off: 0, v: 0 };

    const localPoint = (e: PointerEvent): void => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      ptr.x = ((e.clientX - rect.left) / rect.width) * 160;
      ptr.y = ((e.clientY - rect.top) / rect.height) * 160;
      ptr.active = true;
    };

    const onMove = (e: PointerEvent): void => localPoint(e);

    const onLeave = (): void => {
      ptr.active = false;
      ptr.x = CX;
      ptr.y = CY;
    };

    const onDown = (e: PointerEvent): void => {
      localPoint(e);
      const dx = b.x - ptr.x;
      const dy = b.y - ptr.y;
      const len = Math.hypot(dx, dy) || 1;
      b.vx += (dx / len) * 8;
      b.vy += (dy / len) * 8;
      rad.v -= 24;
    };

    const stepPhysics = (): void => {
      // Body leans toward the pointer (capped so it never leaves home)
      const pdx = ptr.x - CX;
      const pdy = ptr.y - CY;
      const pl = Math.hypot(pdx, pdy) || 1;
      const lean = Math.min(pl, 70) * 0.16;
      const tbx = CX + (pdx / pl) * lean;
      const tby = CY + (pdy / pl) * lean;
      b.vx = (b.vx + (tbx - b.x) * 0.06) * 0.86;
      b.vy = (b.vy + (tby - b.y) * 0.06) * 0.86;
      b.x += b.vx;
      b.y += b.vy;

      // Droplet reaches for an active pointer, clamped inside the goo
      // field; when idle it slowly merges back into the body.
      let tdx: number;
      let tdy: number;
      if (ptr.active) {
        const rdx = ptr.x - b.x;
        const rdy = ptr.y - b.y;
        const rl = Math.hypot(rdx, rdy) || 1;
        const reach = Math.min(rl, 46);
        tdx = b.x + (rdx / rl) * reach;
        tdy = b.y + (rdy / rl) * reach;
      } else {
        tdx = b.x;
        tdy = b.y;
      }
      const dk = ptr.active ? 0.16 : 0.07;
      const dd = ptr.active ? 0.78 : 0.84;
      d.vx = (d.vx + (tdx - d.x) * dk) * dd;
      d.vy = (d.vy + (tdy - d.y) * dk) * dd;
      d.x += d.vx;
      d.y += d.vy;
      const drTarget = ptr.active ? 16 : 13;
      d.r += (drTarget - d.r) * 0.08;

      // Radius wobble spring (poke recoil + idle breathing handled below)
      rad.v += (0 - rad.off) * 0.16;
      rad.v *= 0.8;
      rad.off += rad.v;
    };

    const apply = (t: number): void => {
      const breathe = Math.sin(t * 1.3) * 1.6;
      const r = BODY_R + rad.off + breathe;
      body.setAttribute("cx", b.x.toFixed(2));
      body.setAttribute("cy", b.y.toFixed(2));
      body.setAttribute("r", Math.max(10, r).toFixed(2));
      drop.setAttribute("cx", d.x.toFixed(2));
      drop.setAttribute("cy", d.y.toFixed(2));
      drop.setAttribute("r", d.r.toFixed(2));

      // Volume-preserving squash along the velocity axis = jelly feel
      const sp = Math.hypot(b.vx, b.vy);
      const stretch = Math.min(0.3, sp * 0.035);
      const sx = 1 + stretch;
      const sy = 1 / (1 + stretch);
      const ang = (Math.atan2(b.vy, b.vx) * 180) / Math.PI;
      group.setAttribute(
        "transform",
        `translate(${b.x.toFixed(2)} ${b.y.toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${(-b.x).toFixed(2)} ${(-b.y).toFixed(2)})`,
      );
      shine.setAttribute(
        "transform",
        `translate(${(b.x - CX).toFixed(2)} ${(b.y - CY).toFixed(2)})`,
      );
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let t = 0;

    const tick = (now: number): void => {
      if (document.hidden) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard < 4) {
        stepPhysics();
        acc -= STEP;
        guard += 1;
      }
      apply(t);
      raf = requestAnimationFrame(tick);
    };

    const onVis = (): void => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        acc = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  return (
    <div className="lp-jelly" ref={wrapRef} role="img" aria-label={label}>
      <svg viewBox="0 0 160 160">
        <defs>
          <radialGradient id="lp-jelly-g" cx="38%" cy="34%" r="75%">
            <stop offset="0%" stopColor="var(--gold)" />
            <stop offset="24%" stopColor="oklch(74% 0.2 152)" />
            <stop offset="70%" stopColor="oklch(56% 0.17 152)" />
            <stop offset="100%" stopColor="oklch(34% 0.1 152)" />
          </radialGradient>
          <filter
            id="lp-goo"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
          </filter>
        </defs>

        <g filter="url(#lp-goo)">
          <g className="lp-jelly-sat">
            <circle
              className="lp-jelly-drop"
              cx="80"
              cy="30"
              r="9"
            />
          </g>
          <g ref={groupRef}>
            <circle
              ref={bodyRef}
              className="lp-jelly-body"
              cx="80"
              cy="80"
              r="40"
              fill="url(#lp-jelly-g)"
            />
            <circle
              ref={dropRef}
              className="lp-jelly-drop"
              cx="80"
              cy="80"
              r="14"
            />
          </g>
        </g>

        <g ref={shineRef}>
          <ellipse
            className="lp-jelly-shine"
            cx="64"
            cy="54"
            rx="13"
            ry="8"
            transform="rotate(-20 64 54)"
          />
        </g>
      </svg>
    </div>
  );
}
