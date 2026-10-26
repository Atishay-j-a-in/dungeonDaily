// Environment music — deliberately separate from the DM voice.
// Fetches ElevenLabs-generated beds from GET /api/v1/voice/music/:environment
// (generated once on the server, then cached) and loops them per scene,
// ducked while the DM speaks. No static /public mp3s, no generative-noise
// fake — if the API is unreachable the bed stays silent.

const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:4000";

const FULL_VOLUME = 0.35;
const DUCKED_VOLUME = 0.08;

export class EnvironmentAudio {
  private layers: HTMLAudioElement[] = [];
  private currentEnvironment = "";
  private urlCache = new Map<string, string>();
  private pending = new Map<string, Promise<string | null>>();
  private loadGen = 0;
  // Optional WebAudio graph (master gain + analyser) feeding the orb's
  // energy meter. Attached only when the context actually runs — a suspended
  // context would silence the beds, so direct playback stays the default.
  private graph: {
    context: AudioContext;
    master: GainNode;
    analyser: AnalyserNode;
    samples: Uint8Array<ArrayBuffer>;
  } | null = null;
  private energy = 0;

  get activeEnvironment(): string {
    return this.currentEnvironment;
  }

  /** 0..1 smoothed ambient loudness for the orb. 0 when unattached. */
  getEnergy(): number {
    const g = this.graph;
    if (!g) return 0;
    try {
      g.analyser.getByteTimeDomainData(g.samples);
      let sum = 0;
      for (let i = 0; i < g.samples.length; i += 1) {
        const v = (g.samples[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / g.samples.length);
      const target = Math.min(1, rms * 3.2);
      this.energy += (target - this.energy) * 0.25;
      return this.energy;
    } catch {
      return 0;
    }
  }

  /** Start (or retune) the ambient loop for a scene environment. */
  start(environment: string): void {
    try {
      if (environment === this.currentEnvironment && this.layers.length > 0) {
        void this.playAll();
        return;
      }
      this.currentEnvironment = environment;
      this.stopLayers();
      if (this.graph) {
        try {
          this.graph.master.gain.setTargetAtTime(
            FULL_VOLUME,
            this.graph.context.currentTime,
            0.2,
          );
        } catch {
          // Ignore.
        }
      }
      const gen = ++this.loadGen;
      void this.loadAndPlay(environment, gen);
    } catch {
      // Ambient audio is decorative — never break the game.
    }
  }

  private async loadAndPlay(
    environment: string,
    gen: number,
  ): Promise<void> {
    const url = await this.ensureUrl(environment);
    if (!url || gen !== this.loadGen) return;
    try {
      const audio = new Audio(url);
      audio.loop = true;
      const graphed = this.ensureGraph();
      audio.volume = graphed ? 1 : FULL_VOLUME;
      if (graphed) this.attachLayer(audio);
      if (gen !== this.loadGen) return;
      this.layers.push(audio);
      await this.playAll();
    } catch {
      // Ignore.
    }
  }

  private ensureUrl(environment: string): Promise<string | null> {
    const safe = /^[a-z0-9_]+$/i.test(environment) ? environment : "dungeon";
    const cached = this.urlCache.get(safe);
    if (cached) return Promise.resolve(cached);
    const inflight = this.pending.get(safe);
    if (inflight) return inflight;

    const promise = (async (): Promise<string | null> => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/voice/music/${encodeURIComponent(safe)}`,
        );
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.size === 0) return null;
        const url = URL.createObjectURL(blob);
        this.urlCache.set(safe, url);
        return url;
      } catch {
        return null;
      } finally {
        this.pending.delete(safe);
      }
    })();

    this.pending.set(safe, promise);
    return promise;
  }

  /** Lower ambience while the DM voice speaks so narration stays clear. */
  duck(): void {
    if (this.graph) {
      try {
        this.graph.master.gain.setTargetAtTime(
          DUCKED_VOLUME,
          this.graph.context.currentTime,
          0.2,
        );
      } catch {
        // Ignore.
      }
    } else {
      for (const layer of this.layers) layer.volume = DUCKED_VOLUME;
    }
  }

  /** Restore ambience after TTS ends. */
  restore(): void {
    if (this.graph) {
      try {
        this.graph.master.gain.setTargetAtTime(
          FULL_VOLUME,
          this.graph.context.currentTime,
          0.4,
        );
      } catch {
        // Ignore.
      }
    } else {
      for (const layer of this.layers) layer.volume = FULL_VOLUME;
    }
  }

  /** Stop (with a quick fade) all environment audio, e.g. on session end. */
  stop(fadeSeconds = 0.6): void {
    this.loadGen += 1;
    this.currentEnvironment = "";
    const layers = this.layers;
    this.layers = [];
    if (this.graph) {
      try {
        this.graph.master.gain.setTargetAtTime(
          0,
          this.graph.context.currentTime,
          Math.max(0.05, fadeSeconds / 3),
        );
      } catch {
        // Fall through to immediate stop.
      }
    }
    const stepMs = 50;
    const steps = Math.max(1, Math.floor((fadeSeconds * 1000) / stepMs));
    let step = 0;
    const fade = window.setInterval(() => {
      step += 1;
      const factor = Math.max(0, 1 - step / steps);
      for (const layer of layers) layer.volume = FULL_VOLUME * factor;
      if (step >= steps) {
        window.clearInterval(fade);
        for (const layer of layers) {
          layer.pause();
          layer.removeAttribute("src");
          layer.load();
        }
      }
    }, stepMs);
  }

  private async playAll(): Promise<void> {
    // A user gesture (Start / Speak tap) may have unlocked audio since the
    // last attempt — retry the graph so the orb gets its energy feed.
    if (!this.graph) {
      if (this.ensureGraph()) {
        for (const layer of this.layers) {
          try {
            layer.volume = 1;
            this.attachLayer(layer);
          } catch {
            // Keep direct playback.
          }
        }
      }
    } else {
      try {
        await this.graph.context.resume();
      } catch {
        // Keep playing directly.
      }
    }
    for (const layer of this.layers) {
      try {
        await layer.play();
      } catch {
        // Autoplay blocked until the user interacts — the Start/session
        // click counts as interaction, so retry once on next start().
      }
    }
  }

  /** Build the master gain + analyser once the context runs. */
  private ensureGraph(): boolean {
    if (this.graph) return true;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return false;
      const context = new Ctor();
      // resume() resolves asynchronously: a suspended context means "no
      // gesture yet" — stay on direct playback and retry on the next
      // start()/playAll() once a tap has unlocked audio.
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
        void context.close().catch(() => undefined);
        return false;
      }
      const master = context.createGain();
      master.gain.value = FULL_VOLUME;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      master.connect(analyser);
      analyser.connect(context.destination);
      this.graph = {
        context,
        master,
        analyser,
        samples: new Uint8Array(analyser.fftSize),
      };
      return true;
    } catch {
      return false;
    }
  }

  private attachLayer(audio: HTMLAudioElement): void {
    const g = this.graph;
    if (!g) return;
    try {
      const source = g.context.createMediaElementSource(audio);
      source.connect(g.master);
    } catch {
      // Already attached or unsupported — direct playback continues.
    }
  }

  private stopLayers(): void {
    for (const layer of this.layers) {
      try {
        layer.pause();
        layer.removeAttribute("src");
        layer.load();
      } catch {
        // Ignore.
      }
    }
    this.layers = [];
  }
}
