import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:4000";

interface UseDmVoiceOptions {
  /** Called when audio finishes (or immediately if synthesis fails). */
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/**
 * DM voice via the backend ElevenLabs TTS route. Fetches MP3 for each
 * turn and plays it through an HTMLAudioElement. Never overlaps: each
 * speak() stops the previous clip first. Gameplay never blocks on TTS
 * failure — onEnd always fires so the loop can continue.
 *
 * Replaces the old browser speechSynthesis fake.
 */
export function useSpeechSynthesis(options: UseDmVoiceOptions = {}) {
  const supported = typeof window !== "undefined" && "Audio" in window;

  const [isSpeaking, setIsSpeaking] = useState(false);

  const onEndRef = useRef(options.onEnd);
  onEndRef.current = options.onEnd;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const speakGenRef = useRef(0);
  const graphRef = useRef<{
    context: AudioContext;
    analyser: AnalyserNode;
    source: MediaElementAudioSourceNode;
    samples: Uint8Array<ArrayBuffer>;
  } | null>(null);
  const smoothedEnergyRef = useRef(0);

  const releaseUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopInternal = useCallback(() => {
    speakGenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // Ignore.
      }
    }
    releaseUrl();
    setIsSpeaking(false);
  }, [releaseUrl]);

  const finishSpeaking = useCallback(() => {
    setIsSpeaking(false);
    releaseUrl();
    onEndRef.current?.();
  }, [releaseUrl]);

  const ensureGraph = useCallback((audio: HTMLAudioElement): boolean => {
    if (graphRef.current) return true;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return false;
      const context = new Ctor();
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyser.connect(context.destination);
      graphRef.current = {
        context,
        analyser,
        source,
        samples: new Uint8Array(analyser.fftSize),
      };
      return true;
    } catch {
      return false;
    }
  }, []);

  const getVoiceEnergy = useCallback((): number => {
    const g = graphRef.current;
    const audio = audioRef.current;
    const active = isSpeaking && audio && !audio.paused;
    if (!g || !active) {
      smoothedEnergyRef.current *= 0.82;
      if (smoothedEnergyRef.current < 0.01) smoothedEnergyRef.current = 0;
      return smoothedEnergyRef.current;
    }
    try {
      g.analyser.getByteTimeDomainData(g.samples);
      let sum = 0;
      for (let i = 0; i < g.samples.length; i += 1) {
        const v = (g.samples[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / g.samples.length);
      const target = Math.min(1, rms * 3.4);
      smoothedEnergyRef.current += (target - smoothedEnergyRef.current) * 0.35;
      return Math.min(1, Math.max(0, smoothedEnergyRef.current));
    } catch {
      return smoothedEnergyRef.current;
    }
  }, [isSpeaking]);

  const speak = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed) {
        onEndRef.current?.();
        return;
      }
      // Prevent overlap: cancel any active speech first.
      stopInternal();
      const gen = ++speakGenRef.current;

      void (async () => {
        try {
          const res = await fetch(`${API_BASE}/api/v1/voice/synthesize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: trimmed.slice(0, 4000) }),
          });
          if (gen !== speakGenRef.current) return;
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              error?: { message?: string };
            };
            throw new Error(
              data.error?.message ?? `TTS HTTP ${res.status}`,
            );
          }
          const blob = await res.blob();
          if (gen !== speakGenRef.current) return;
          if (blob.size === 0) throw new Error("Empty TTS audio");

          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          audio.preload = "auto";
          ensureGraph(audio);
          audio.onended = () => {
            if (gen !== speakGenRef.current) return;
            finishSpeaking();
          };
          audio.onerror = () => {
            if (gen !== speakGenRef.current) return;
            setIsSpeaking(false);
            onErrorRef.current?.("DM voice playback failed; continuing.");
            onEndRef.current?.();
          };
          audio.src = url;
          setIsSpeaking(true);
          await audio.play();
        } catch (err) {
          if (gen !== speakGenRef.current) return;
          setIsSpeaking(false);
          onErrorRef.current?.(
            err instanceof Error
              ? err.message
              : "DM voice unavailable; continuing without voice.",
          );
          // TTS failure must never block the game.
          onEndRef.current?.();
        }
      })();
    },
    [ensureGraph, finishSpeaking, stopInternal],
  );

  const stop = useCallback((): void => {
    stopInternal();
  }, [stopInternal]);

  // Unmount: stop audio and free the object URL.
  useEffect(
    () => () => {
      stopInternal();
      try {
        graphRef.current?.context.close().catch(() => undefined);
      } catch {
        // Ignore.
      }
      graphRef.current = null;
    },
    [stopInternal],
  );

  return {
    supported,
    isSpeaking,
    speak,
    stop,
    pause: () => undefined,
    resume: () => undefined,
    getVoiceEnergy,
  };
}
