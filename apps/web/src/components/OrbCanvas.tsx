import { useEffect, useRef } from "react";

// Plasma Orb: smooth dependency-free WebGL 1.0 sphere filled with domain-warped
// plasma currents — broad soft wisps, a breathing core, and voice-driven ripple
// shockwaves that surge with the DM's analyser energy. States read plainly:
// idle breathes, thinking spins an inward vortex, speaking ripples with the
// voice, listening cools to teal, error flickers ember, awakening sends rings.

export type OrbState =
  | "idle"
  | "thinking"
  | "speaking"
  | "listening"
  | "error"
  | "awakening";

export interface OrbCanvasProps {
  state: OrbState;
  /** Backend mood id (calm, mysterious, tense, combat, victorious, danger). */
  mood?: string;
  /** Time trial setting: 10 (Squire's emerald), 20 (Deep sapphire), 30 (Dragon ruby). */
  trial?: 10 | 20 | 30;
  /** 0..1 ambient/voice energy sampled from audio graph & speech (ref: no re-render). */
  energyRef?: React.MutableRefObject<number>;
  /** True = single static frame (reduced motion / stillness toggle). */
  still?: boolean;
  /** spirit = airy glow; crystal = denser structured currents. */
  variant?: "spirit" | "crystal";
  /** Is this orb enlarged into hero focus? */
  enlarged?: boolean;
  /** Is this orb in its summoning awakening ritual? */
  awakening?: boolean;
  label: string;
  className?: string;
}

const TRIAL_PALETTES: Record<
  number,
  { base: [number, number, number]; core: [number, number, number] }
> = {
  10: {
    // Squire's Trial: Deep emerald living plasma with golden radiant core
    base: [0.04, 0.8, 0.42],
    core: [0.92, 0.76, 0.12],
  },
  20: {
    // Deep Delve: Abyssal arcane sapphire with electric celestial cyan currents
    base: [0.08, 0.42, 0.95],
    core: [0.05, 0.82, 0.96],
  },
  30: {
    // Dragon's Vigil: Dragon heart crimson ruby with molten amber flares
    base: [0.88, 0.14, 0.10],
    core: [0.98, 0.62, 0.08],
  },
};

const MOOD_PALETTES: Record<
  string,
  { base: [number, number, number]; core: [number, number, number] }
> = {
  calm: { base: [0.05, 0.74, 0.44], core: [0.85, 0.82, 0.25] },
  mysterious: { base: [0.10, 0.42, 0.88], core: [0.35, 0.78, 0.98] },
  tense: { base: [0.75, 0.48, 0.12], core: [0.95, 0.75, 0.25] },
  combat: { base: [0.85, 0.28, 0.10], core: [0.98, 0.58, 0.15] },
  victorious: { base: [0.88, 0.68, 0.18], core: [0.98, 0.88, 0.35] },
  danger: { base: [0.82, 0.12, 0.10], core: [0.95, 0.52, 0.12] },
};

const DEFAULT_PALETTE = {
  base: [0.08, 0.62, 0.7] as [number, number, number],
  core: [0.88, 0.72, 0.25] as [number, number, number],
};

const VERT = `attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_time;
uniform float u_speak;
uniform float u_energy;
uniform float u_listen;
uniform float u_think;
uniform float u_error;
uniform float u_awake;
uniform float u_crystal;
uniform vec3 u_base_col;
uniform vec3 u_core_col;
uniform vec3 u_mood;
uniform vec2 u_mouse;

// Deterministic 3D Hash & Value Noise
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash3(p + vec3(0.0, 0.0, 0.0)), hash3(p + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash3(p + vec3(0.0, 1.0, 0.0)), hash3(p + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash3(p + vec3(0.0, 0.0, 1.0)), hash3(p + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash3(p + vec3(0.0, 1.0, 1.0)), hash3(p + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p = p * 2.02 + vec3(1.3, 2.7, 4.1);
    a *= 0.5;
  }
  return v;
}

// 2D noise for atmosphere sparkles
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// ACES Film Tone Mapping: zero white clipping, rich saturation
vec3 toneMapACES(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);

  // Perspective ray toward the plasma sphere
  vec3 ro = vec3(0.0, 0.0, 2.2);
  vec3 rd = normalize(vec3(uv - u_mouse * 0.1, -1.65));

  float R = 0.7;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float h = b * b - c;

  // Shared state dynamics
  float breath = 0.5 + 0.5 * sin(u_time * 1.3);
  float swirl = 0.4 + u_speak * 1.5 + u_energy * 1.1 + u_think * 1.3 + u_awake * 1.7;
  float glow = 0.32
    + u_speak * (0.45 + 0.55 * u_energy)
    + u_energy * 0.35
    + u_awake * 0.5
    + u_think * 0.18
    + breath * 0.06;

  // Outer aura halo: falloff measured from the sphere's projected silhouette
  // (~0.55 for this camera) so the glow never fills the canvas as a flat
  // square. Aura coverage becomes the fragment's alpha — the orb floats on
  // whatever surface sits behind it instead of showing an opaque quad.
  float bodyR = 0.55;
  float r2d = length(uv);
  float auraDist = max(0.0, r2d - bodyR);
  float aura = exp(-auraDist * 7.0) * glow;
  float auraA = exp(-auraDist * 10.0);
  float spk = pow(noise2(uv * 16.0 + vec2(u_time * 0.3, -u_time * 0.22)), 10.0)
    * exp(-r2d * 3.0)
    * (0.3 + u_energy * 0.9 + u_awake * 0.8);
  vec3 auraCol = u_base_col * aura * 0.8 + u_core_col * spk;

  if (h < 0.0) {
    float vig = 1.0 - smoothstep(0.3, 1.0, r2d);
    vec3 c = toneMapACES(auraCol * mix(0.35, 1.0, vig));
    gl_FragColor = vec4(c, clamp(auraA + spk * 2.0, 0.0, 1.0));
    return;
  }

  // March the sphere interior: soft domain-warped plasma, no facets
  float t_in = -b - sqrt(h);
  float t_out = -b + sqrt(h);
  vec3 p_in = ro + rd * t_in;
  vec3 nrm = normalize(p_in);

  float stepSize = (t_out - t_in) / 14.0;
  vec3 pos = p_in + rd * stepSize * 0.5;
  float freq = mix(2.7, 3.5, u_crystal);
  vec3 accum = vec3(0.0);

  for (int i = 0; i < 14; i++) {
    float rOrig = length(pos);
    if (rOrig < R) {
      // The core leans toward the pointer for a lived-in, reactive feel
      vec3 pc = pos - vec3(u_mouse * 0.13, 0.0);
      float rr = length(pc);

      // Slow Y-axis swirl; thinking adds inward vertical drift (vortex pull)
      float twist = (1.0 - rOrig / R) * 2.2 + u_time * swirl;
      float cs = cos(twist);
      float sn = sin(twist);
      vec3 sp = vec3(
        pc.x * cs - pc.z * sn,
        pc.y + u_time * (0.2 * u_think - 0.1),
        pc.x * sn + pc.z * cs
      );

      float n = fbm3(sp * freq);
      float wisp = smoothstep(0.4, 0.78, n);
      float core = exp(
        -rr * (5.0 - breath * 0.7 - u_speak * 1.5 - u_energy * 1.0 - u_awake * 1.1)
      );

      // Voice-reactive shockwave travelling outward through the plasma
      float rip = sin(rr * 18.0 - u_time * (9.0 + u_speak * 9.0)) * 0.5 + 0.5;
      rip *= (u_speak * 0.8 + u_energy * 0.55 + u_awake * 0.45) * (1.0 - rOrig / R);

      // Awakening: a bright ring expanding from the heart to the shell
      float ring = 0.0;
      if (u_awake > 0.01) {
        ring = (1.0 - smoothstep(0.0, 0.05, abs(rOrig - fract(u_time * 0.55) * R)))
          * u_awake * 0.8;
      }

      vec3 col = mix(u_base_col * 0.14, u_base_col, wisp);
      col = mix(col, u_core_col, clamp(core * 1.15 + rip * 0.6 + ring, 0.0, 1.0));
      float dens = core * 0.85 + wisp * 0.28 + rip * 0.35 + ring * 0.5;
      accum += col * dens * stepSize
        * (1.15 + u_speak * 1.0 + u_energy * 0.8 + u_awake * 0.8 + u_think * 0.25);
    }
    pos += rd * stepSize;
  }

  // Crisp fresnel rim + a single soft top light for form
  float fres = pow(1.0 - max(0.0, dot(-rd, nrm)), 2.6);
  vec3 body = accum;
  body += mix(u_base_col, u_core_col, 0.55) * fres
    * (0.55 + u_speak * 0.5 + u_energy * 0.35 + u_listen * 0.25 + u_awake * 0.4);
  float lit = pow(
    max(0.0, dot(reflect(rd, nrm), normalize(vec3(0.45, 0.8, 0.75)))),
    18.0
  );
  body += mix(u_core_col, vec3(1.0), 0.3) * lit * 0.3;

  // State reactivity: mood rim, listening teal, error ember flicker
  body = mix(body, u_mood, fres * 0.3);
  body = mix(body, vec3(0.13, 0.68, 0.7), u_listen * 0.32);
  float flick = 1.0 - u_error * 0.3 * (0.5 + 0.5 * sin(u_time * 24.0));
  body = mix(body, vec3(0.75, 0.16, 0.11), u_error * 0.45);
  body *= flick;

  vec3 outCol = body + auraCol * 0.5;
  float vig = 1.0 - smoothstep(0.28, 1.0, r2d);
  outCol *= mix(0.45, 1.0, vig);

  vec3 graded = pow(toneMapACES(outCol * 1.3), vec3(0.92));
  gl_FragColor = vec4(graded, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  gl.shaderSource(vs, VERT);
  gl.shaderSource(fs, FRAG);
  gl.compileShader(vs);
  gl.compileShader(fs);

  if (
    !gl.getShaderParameter(vs, gl.COMPILE_STATUS) ||
    !gl.getShaderParameter(fs, gl.COMPILE_STATUS)
  ) {
    const fsLog = gl.getShaderInfoLog(fs);
    if (fsLog) console.warn("[orb] Fragment shader compile log:", fsLog);
    return null;
  }

  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[orb] Program link error:", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

export function OrbCanvas({
  state,
  mood = "mysterious",
  trial,
  energyRef,
  still = false,
  variant = "crystal",
  enlarged = false,
  awakening = false,
  label,
  className = "orb-canvas",
}: OrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef<[number, number]>([0, 0]);

  // Compute active palette
  const activePalette = trial
    ? TRIAL_PALETTES[trial] ?? DEFAULT_PALETTE
    : MOOD_PALETTES[mood] ?? DEFAULT_PALETTE;

  const stateRef = useRef({
    state,
    mood,
    variant,
    enlarged,
    awakening,
    baseCol: activePalette.base,
    coreCol: activePalette.core,
  });
  stateRef.current = {
    state,
    mood,
    variant,
    enlarged,
    awakening,
    baseCol: activePalette.base,
    coreCol: activePalette.core,
  };

  const stillRef = useRef(still);
  stillRef.current = still;
  const kickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fail = (reason: string): void => {
      canvas.dataset.nogl = "true";
      console.warn(`[orb] WebGL fallback active (${reason}).`);
    };

    let gl: WebGLRenderingContext | null = null;
    try {
      if (typeof window.WebGLRenderingContext === "undefined") {
        fail("no WebGL support");
        return;
      }
      gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        powerPreference: "high-performance",
      }) as WebGLRenderingContext | null;
      if (!gl || gl.isContextLost()) {
        fail("context lost or unavailable");
        return;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      return;
    }

    const prog = compileShader(gl);
    if (!prog) {
      fail("shader compile failed");
      return;
    }

    const onLost = (e: Event): void => {
      e.preventDefault();
      fail("context lost");
    };
    canvas.addEventListener("webglcontextlost", onLost);

    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const loc = (name: string): WebGLUniformLocation | null =>
      gl.getUniformLocation(prog, name);
    const uRes = loc("u_res");
    const uTime = loc("u_time");
    const uSpeak = loc("u_speak");
    const uEnergy = loc("u_energy");
    const uListen = loc("u_listen");
    const uThink = loc("u_think");
    const uError = loc("u_error");
    const uAwake = loc("u_awake");
    const uCrystal = loc("u_crystal");
    const uBaseCol = loc("u_base_col");
    const uCoreCol = loc("u_core_col");
    const uMood = loc("u_mood");
    const uMouse = loc("u_mouse");

    let raf = 0;
    let running = true;
    let last = performance.now();
    const smooth = {
      speak: 0,
      energy: 0,
      listen: 0,
      think: 0,
      error: 0,
      awake: 0,
      mouseX: 0,
      mouseY: 0,
    };
    let t = Math.random() * 100;

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
      const w = Math.max(2, Math.floor(rect.width * dpr));
      const h = Math.max(2, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;
    ro?.observe(canvas);

    const handlePointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = -(((e.clientY - rect.top) / rect.height - 0.5) * 2);
        mouseRef.current = [nx, ny];
      }
    };
    canvas.addEventListener("pointermove", handlePointerMove);

    const draw = (now: number): void => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!stillRef.current) t += dt;

      const {
        state: st,
        variant: vr,
        awakening: isAwake,
        baseCol,
        coreCol,
      } = stateRef.current;

      const currentEnergy = energyRef ? energyRef.current : 0;
      const target = {
        speak: st === "speaking" ? 1 : 0,
        energy:
          st === "speaking" || st === "thinking" || isAwake
            ? Math.max(0.2, currentEnergy)
            : currentEnergy,
        listen: st === "listening" ? 1 : 0,
        think: st === "thinking" ? 1 : 0,
        error: st === "error" ? 1 : 0,
        awake: isAwake || st === "awakening" ? 1 : 0,
        mouseX: mouseRef.current[0],
        mouseY: mouseRef.current[1],
      };

      const k = stillRef.current ? 1 : 1 - Math.exp(-dt * 6);
      smooth.speak += (target.speak - smooth.speak) * k;
      smooth.energy += (target.energy - smooth.energy) * k;
      smooth.listen += (target.listen - smooth.listen) * k;
      smooth.think += (target.think - smooth.think) * k;
      smooth.error += (target.error - smooth.error) * k;
      smooth.awake += (target.awake - smooth.awake) * k;
      smooth.mouseX += (target.mouseX - smooth.mouseX) * k;
      smooth.mouseY += (target.mouseY - smooth.mouseY) * k;

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uSpeak, smooth.speak);
      gl.uniform1f(uEnergy, Math.min(1, Math.max(0, smooth.energy)));
      gl.uniform1f(uListen, smooth.listen);
      gl.uniform1f(uThink, smooth.think);
      gl.uniform1f(uError, smooth.error);
      gl.uniform1f(uAwake, smooth.awake);
      gl.uniform1f(uCrystal, vr === "crystal" ? 1 : 0);
      gl.uniform3f(uBaseCol, baseCol[0], baseCol[1], baseCol[2]);
      gl.uniform3f(uCoreCol, coreCol[0], coreCol[1], coreCol[2]);
      gl.uniform3f(uMood, baseCol[0], baseCol[1], baseCol[2]);
      gl.uniform2f(uMouse, smooth.mouseX, smooth.mouseY);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!stillRef.current) raf = requestAnimationFrame(draw);
    };

    const onVis = (): void => {
      if (!document.hidden && !stillRef.current) {
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    kickRef.current = () => {
      if (stillRef.current || document.hidden) return;
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };

    last = performance.now();
    if (stillRef.current) {
      draw(last);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pointermove", handlePointerMove);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!still) kickRef.current?.();
  }, [still]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={className}
    />
  );
}
