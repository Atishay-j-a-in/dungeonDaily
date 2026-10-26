// One-shot sound effects for the backend's `soundEffects` IDs. The DM turn
// carries IDs from the engine allowlist (scene-engine.ts); this engine
// fetches ElevenLabs-generated audio from GET /api/v1/voice/sfx/:id and
// caches the blob URLs. Unknown IDs stay silent — a missing asset must
// never break the game or the narration.

const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:4000";

const MAX_PER_TURN = 2;
const STAGGER_MS = 140;
const SFX_VOLUME = 0.5;
const MUTE_KEY = "dd-muted";

export class SfxEngine {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string | null>>();
  muted: boolean;

  constructor() {
    try {
      this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Persistence is a nicety, not a requirement.
    }
  }

  /** Play up to MAX_PER_TURN effects, staggered so impacts don't stack. */
  play(ids: readonly string[] | undefined): void {
    if (this.muted || !ids || ids.length === 0) return;
    try {
      const picks: string[] = [];
      for (const id of ids) {
        if (/^[a-z0-9_]+$/i.test(id) && !picks.includes(id) && picks.length < MAX_PER_TURN) {
          picks.push(id);
        }
      }
      picks.forEach((id, index) => {
        window.setTimeout(() => {
          void this.playId(id);
        }, index * STAGGER_MS);
      });
    } catch {
      // Decorative audio never breaks the game.
    }
  }

  private async playId(id: string): Promise<void> {
    if (this.muted) return;
    try {
      const url = await this.ensureUrl(id);
      if (!url || this.muted) return;
      const audio = new Audio(url);
      audio.volume = SFX_VOLUME;
      audio.preload = "auto";
      await audio.play();
    } catch {
      // Ignore — SFX are decorative.
    }
  }

  private ensureUrl(id: string): Promise<string | null> {
    const cached = this.cache.get(id);
    if (cached) return Promise.resolve(cached);
    const inflight = this.pending.get(id);
    if (inflight) return inflight;

    const promise = (async (): Promise<string | null> => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/voice/sfx/${encodeURIComponent(id)}`,
        );
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.size === 0) return null;
        const url = URL.createObjectURL(blob);
        this.cache.set(id, url);
        return url;
      } catch {
        return null;
      } finally {
        this.pending.delete(id);
      }
    })();

    this.pending.set(id, promise);
    return promise;
  }
}
