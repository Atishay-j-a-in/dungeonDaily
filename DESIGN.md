# Design

Ember Dungeon theme for the DungeonsDaily session UI (product register).

## Theme

Dark-only, mobile-first, orb-led. Dark green-black stone saturated with
vibrant, bright dungeon green carries the adventure; molten gold appears
only for DM speech, exercise calls, and victory. Depth comes from surface
lightness steps, never shadows.

## Palette (OKLCH)

| Role | Token | Value |
|---|---|---|
| App bg | `--bg-0` | `oklch(13% 0.05 155)` |
| Raised / panel / elevated | `--bg-1/2/3` | `18% / 23.5% / 29%`, chroma 0.06–0.075, hue 155 |
| Body / secondary / caption text | `--ink/dim/faint` | `96% / 84% / 73%`, green-tinted |
| Accent (actions, DM, victory) | `--gold` | `oklch(84% 0.16 90)` |
| Accent hover / borders | `--gold-soft/deep` | `77% / 67%` same hue |
| Exercise wash | `--gold-wash` | gold at 12% alpha |
| Highlight green | `--jade/moss` | vibrant `84%/0.2/150`, `84%/0.19/150` |
| Danger / warning | `--ember/amber-note` | bright red `72%/0.17/28`, amber `84%/0.15/80` |
| Hairlines / focus | `--line / --focus` | `35%/0.06/155`, gold |

Body text contrasts: ink ~17:1, dim ~11:1, faint ~7:1, gold ~12:1 on `--bg-0`.

## Typography

- Display serif (`Iowan Old Style, Palatino, Georgia`) for adventure title
  and DM narration only. System sans for all UI chrome.
- Fixed rem scale: `0.75 / 0.875 / 1 / 1.25 / 1.5 / 2`. Body 1rem/1.6 with
  +0.01em tracking (light-on-dark compensation). `balance` on headings,
  `pretty` on prose. Stats use `tabular-nums`.

## Components

- **Orb** (`OrbCanvas`): dependency-free WebGL shader; breathes idle,
  molten swirl on DM speech (TTS state + analyser energy), teal on listen,
  ember on error; rim tinted by backend mood. Single static frame when
  `still` (reduced-motion default + toggle). CSS ember-glow fallback.
- **Buttons**: `.btn-primary` gold (flex-grows), `.btn-quiet` stone with
  hairline; 44px targets, 48px on coarse pointers; labels are verb+object.
- **Exercise panel**: gold wash + full hairline border (never side stripes).
- **Chips** (mute/stillness), **disclosures** (voice settings, log),
  **notices** (amber wash + full border). Semantic z-scale, expo-out
  150/240ms motion, reduced-motion kill-switch.

## Layout

Single column, `34rem` shell, `100dvh`, safe-area insets, `viewport-fit`.
Order: title/status → orb → stats → narration → prompt → exercise →
controls → input → utilities → settings → log. Orb frame
`min(78vw, 300px)`; two-column only above `48rem` padding step.
Desktop keeps the same column (glanceable game surface, not a dashboard).

## Audio

Ambient beds per environment (`EnvironmentAudio`, ducked under TTS) with an
optional WebAudio analyser feeding orb energy (direct playback when the
context is suspended). One-shot SFX (`SfxEngine`) map backend
`soundEffects` IDs to `/public` files; unmapped IDs stay silent. Mute
persists (`dd-muted`); stillness persists (`dd-still-orb`).

## Auth gate (Clerk)

Signed-out visitors get a login screen (sign-in / create-account modal
buttons, gold primary). The app shell renders only for signed-in users;
`UserButton` lives in the chronicle head. Every API call carries the Clerk
session token; the API derives identity from the verified token and refuses
foreign history reads (403).

## Orb gate

Three crystal orbs (faceted `crystal` shader variant) for 10 / 20 /
30 minutes, each with its own energy character and mood. Tapping one starts
that trial; the orb becomes the live session orb.

## Chronicle sidebar

Per-user Mongo history: drawer with scrim under 64rem, persistent panel
above. Past delves open as read-only replays (narration + prompts), never
touching the live session.
