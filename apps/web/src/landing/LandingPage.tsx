import { useEffect, useRef, useState } from "react";
import { SignInButton, SignUpButton } from "@clerk/react";
import { JellyOrb } from "./JellyOrb.js";

// Signed-out landing: live plasma orb hero with pointer-following glow, a
// step-through animated SVG demo of one real game turn, and the three trials
// as the path into sign-in. Autoplay honors reduced motion (manual steps),
// and every animated state has a static fallback under the global kill-switch.

const STEP_MS = 3600;

const STEPS = [
  {
    id: "speak",
    label: "Speak",
    caption: "You answer out loud — no menus, no typing mid-set.",
  },
  {
    id: "ponder",
    label: "Ponder",
    caption: "The Dungeon Master weighs your words in the dark.",
  },
  {
    id: "reply",
    label: "Reply",
    caption: "The story returns as voice and text, scene by scene.",
  },
  {
    id: "trial",
    label: "Trial",
    caption: "When the tale demands movement, the trial arrives in gold.",
  },
  {
    id: "reward",
    label: "Reward",
    caption: "Body the trial, bank the XP — the chronicle remembers.",
  },
];

const TRIALS = [
  {
    minutes: 10 as const,
    name: "Squire's Trial",
    desc: "A quick patrol of the outer halls.",
    sigil: "emerald",
  },
  {
    minutes: 20 as const,
    name: "Deep Delve",
    desc: "Down where the old stories sleep.",
    sigil: "sapphire",
  },
  {
    minutes: 30 as const,
    name: "Dragon's Vigil",
    desc: "The long watch. The hoard is earned.",
    sigil: "ruby",
  },
];

const WAVE_BARS = [0.5, 0.9, 0.65, 1, 0.7, 0.95, 0.6, 0.8];

function prefersReduced(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function LandingPage() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReduced());
  const [reduced] = useState(() => prefersReduced());
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, step]);

  function trackPointer(e: React.PointerEvent<HTMLElement>): void {
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty(
      "--lx",
      `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`,
    );
    el.style.setProperty(
      "--ly",
      `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`,
    );
  }

  return (
    <div className="lp">
      <header className="lp-bar">
        <span className="lp-brand">
          <svg className="lp-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5 19.5 9 12 21.5 4.5 9Z" />
            <path d="M4.5 9h15M12 2.5V21.5M8 9l4-6.5L16 9l-4 12.5Z" />
          </svg>
          <span className="lp-wordmark">DungeonsDaily</span>
        </span>
        <SignInButton mode="modal">
          <button className="lp-signin" type="button">
            Sign in
          </button>
        </SignInButton>
      </header>

      <main className="lp-main">
        <section
          className="lp-hero"
          ref={heroRef}
          onPointerMove={trackPointer}
        >
          <span className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-hero-copy">
            <h1 className="lp-title">The dungeon listens. Speak your move.</h1>
            <p className="lp-lede">
              Ten to thirty minutes inside a living story. The Dungeon Master
              narrates out loud, you answer out loud, and every rep moves the
              plot — you finish the workout because your character needs to
              survive it.
            </p>
            <div className="lp-cta">
              <SignUpButton mode="modal">
                <button className="adv-btn adv-btn-speak" type="button">
                  Begin your first delve
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button className="adv-btn adv-btn-quiet" type="button">
                  I have an account
                </button>
              </SignInButton>
            </div>
            <a className="lp-watch" href="#lp-demo">
              Watch one turn
              <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="lp-hero-orb">
            <JellyOrb
              reduced={reduced}
              label="Jelly plasma orb of the Dungeon Master — moves with your cursor"
            />
          </div>
        </section>

        <section className="lp-demo" id="lp-demo" aria-labelledby="lp-demo-title">
          <div className="lp-demo-head">
            <h2 className="lp-demo-title" id="lp-demo-title">
              One turn of the delve
            </h2>
            <button
              className="lp-demo-toggle"
              type="button"
              aria-pressed={playing}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? "❙❙ Pause" : "▶ Play"}
            </button>
          </div>

          <div className="lp-stage">
            <svg
              className="lp-svg"
              data-step={step}
              viewBox="0 0 480 360"
              role="img"
              aria-label={`Animated demo, step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}
            >
              <defs>
                <radialGradient id="lp-orb-g" cx="40%" cy="36%" r="72%">
                  <stop offset="0%" className="lp-stop-core" />
                  <stop offset="42%" className="lp-stop-mid" />
                  <stop offset="100%" className="lp-stop-edge" />
                </radialGradient>
              </defs>

              <rect
                className="lp-frame"
                x="6"
                y="6"
                width="468"
                height="348"
                rx="18"
              />
              <line
                className="lp-divider"
                x1="204"
                y1="42"
                x2="204"
                y2="318"
              />

              <g className="lp-orb" transform="translate(104 176)">
                <circle className="lp-orb-aura" r="72" />
                <circle className="lp-orb-body" r="52" fill="url(#lp-orb-g)" />
                <path
                  className="lp-orb-swirl"
                  d="M -42 16 A 46 46 0 0 1 36 -30"
                />
                <circle className="lp-orb-ring" r="62" />
                <circle className="lp-orb-pulse" r="52" />
              </g>

              {step === 0 && (
                <g className="lp-layer">
                  <rect
                    className="lp-bubble"
                    x="222"
                    y="92"
                    width="242"
                    height="62"
                    rx="14"
                  />
                  <text className="lp-dialog" x="238" y="130">
                    “I open the obsidian door.”
                  </text>
                  <circle className="lp-mic" cx="240" cy="196" r="17" />
                  <path
                    className="lp-mic-glyph"
                    d="M 236 191 v 6 a 4 4 0 0 0 8 0 v -6 a 4 4 0 0 0 -8 0 z M 232 197 a 8 8 0 0 0 16 0 M 240 205 v 4 M 236 209 h 8"
                  />
                  <g className="lp-wave">
                    {WAVE_BARS.map((h, i) => (
                      <rect
                        key={i}
                        className="lp-wave-bar"
                        x={268 + i * 11}
                        y={196 - 11 * h}
                        width="5"
                        height={22 * h}
                        rx="2.5"
                        style={{ animationDelay: `${i * 90}ms` }}
                      />
                    ))}
                  </g>
                  <text className="lp-micro" x="366" y="201">
                    you, out loud
                  </text>
                </g>
              )}

              {step === 1 && (
                <g className="lp-layer">
                  <text className="lp-dialog" x="222" y="142">
                    The Dungeon Master ponders…
                  </text>
                  <g className="lp-dots">
                    <circle className="lp-dot" cx="230" cy="180" r="5" />
                    <circle className="lp-dot" cx="252" cy="180" r="5" />
                    <circle className="lp-dot" cx="274" cy="180" r="5" />
                  </g>
                  <text className="lp-micro" x="222" y="224">
                    consulting the dark mists
                  </text>
                </g>
              )}

              {step === 2 && (
                <g className="lp-layer">
                  <rect
                    className="lp-card"
                    x="222"
                    y="84"
                    width="242"
                    height="152"
                    rx="14"
                  />
                  <text className="lp-narr lp-n1" x="238" y="126">
                    Beyond, a gargoyle stirs —
                  </text>
                  <text className="lp-narr lp-n2" x="238" y="158">
                    it guards the stair.
                  </text>
                  <text className="lp-micro lp-n3" x="238" y="210">
                    the Dungeon Master, out loud
                  </text>
                </g>
              )}

              {step === 3 && (
                <g className="lp-layer">
                  <rect
                    className="lp-trial-card"
                    x="222"
                    y="84"
                    width="242"
                    height="166"
                    rx="14"
                  />
                  <text className="lp-trial-name" x="238" y="128">
                    10 push-ups
                  </text>
                  <text className="lp-trial-detail" x="238" y="158">
                    before the obsidian door opens
                  </text>
                  <rect
                    className="lp-track"
                    x="238"
                    y="182"
                    width="210"
                    height="10"
                    rx="5"
                  />
                  <rect
                    className="lp-fill"
                    x="238"
                    y="182"
                    width="210"
                    height="10"
                    rx="5"
                  />
                  <text className="lp-micro" x="238" y="230">
                    speak it done — or tap Complete
                  </text>
                </g>
              )}

              {step === 4 && (
                <g className="lp-layer">
                  <g className="lp-xp">
                    <rect
                      className="lp-xp-chip"
                      x="283"
                      y="116"
                      width="120"
                      height="48"
                      rx="24"
                    />
                    <text className="lp-xp-text" x="343" y="147">
                      +20 XP
                    </text>
                  </g>
                  <text className="lp-dialog" x="343" y="216" textAnchor="middle">
                    Level 2 — the stair is yours
                  </text>
                </g>
              )}
            </svg>
            <p className="lp-stage-caption" aria-live="polite">
              {STEPS[step].caption}
            </p>
          </div>

          <div className="lp-steps" role="group" aria-label="Demo steps">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`lp-step${step === i ? " is-active" : ""}`}
                aria-pressed={step === i}
                onClick={() => {
                  setStep(i);
                  setPlaying(false);
                }}
              >
                <span className="lp-step-num" aria-hidden="true">
                  {i + 1}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <section
          className="lp-trials"
          aria-labelledby="lp-trials-title"
        >
          <h2 className="lp-trials-title" id="lp-trials-title">
            Three trials hum in the dark
          </h2>
          <p className="lp-trials-lede">
            Choose the depth of your first delve. Sign-in keeps the chronicle
            in your vault.
          </p>
          <ul className="lp-trial-list">
            {TRIALS.map((t) => (
              <li key={t.minutes}>
                <SignUpButton mode="modal">
                  <button
                    className="lp-trial"
                    type="button"
                    data-sigil={t.sigil}
                  >
                    <span className="lp-trial-sigil" aria-hidden="true">
                      <svg viewBox="0 0 48 48">
                        <circle
                          className="lp-sigil-aura"
                          cx="24"
                          cy="24"
                          r="21"
                        />
                        <circle
                          className="lp-sigil-orbit"
                          cx="24"
                          cy="24"
                          r="21"
                        />
                        <circle
                          className="lp-sigil-core"
                          cx="24"
                          cy="24"
                          r="10"
                        />
                      </svg>
                    </span>
                    <span className="lp-trial-copy">
                      <span className="lp-trial-name">{t.name}</span>
                      <span className="lp-trial-desc">{t.desc}</span>
                    </span>
                    <span className="lp-trial-mins">{t.minutes} min</span>
                    <span className="lp-trial-go" aria-hidden="true">
                      →
                    </span>
                  </button>
                </SignUpButton>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="lp-foot">
        <p>
          Voice-first, screen-second. Motion can be stilled anytime, and every
          sound has a mute.
        </p>
      </footer>
    </div>
  );
}
