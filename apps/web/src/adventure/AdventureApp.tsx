import { useCallback, useEffect, useRef, useState } from "react";
import {
  Show,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/react";
import * as Sentry from "@sentry/react";
import { OrbCanvas, type OrbState } from "../components/OrbCanvas.js";
import { LandingPage } from "../landing/LandingPage.js";
import { EnvironmentAudio } from "../voice/environmentAudio.js";
import { SfxEngine } from "../voice/sfx.js";
import { useSpeechRecognition } from "../voice/useSpeechRecognition.js";
import { useSpeechSynthesis } from "../voice/useSpeechSynthesis.js";

// Fresh adventure UI: orb gate, live session, sidebar chronicle. The demo
// App.tsx is untouched; this shell owns its own state machine but reuses the
// proven voice/audio engines and the same backend contract. Every write route
// carries the Clerk session token; history is strictly per-user.

const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:4000";

type MicState = "IDLE" | "LISTENING" | "PROCESSING" | "DM_SPEAKING" | "ERROR";
type View = "gate" | "live" | "replay";

interface PlayerState {
  xp: number;
  health: number;
  level: number;
}

interface CurrentExercise {
  exerciseId: string;
  reps?: number;
  durationSeconds?: number;
  completed: boolean;
}

interface SessionView {
  sessionId: string;
  status: string;
  adventure: { title: string };
  player?: PlayerState;
  currentExercise?: CurrentExercise;
  lastNarration?: string;
  lastPrompt?: string;
  lastScene?: string;
  isExerciseTurn?: boolean;
  turnCount?: number;
}

interface DmAction {
  type: string;
  prompt?: string;
  exerciseId?: string;
  reps?: number;
  durationSeconds?: number;
}

interface DmTurn {
  narration: string;
  mood?: string;
  action?: DmAction;
  scene?: {
    environment?: string;
    ambientSounds?: string[];
    soundEffects?: string[];
  };
  ai?: { provider: string; degraded: boolean; reason: string | null };
}

interface TurnRecord {
  turnNumber: number;
  userInput?: { text?: string };
  dmOutput?: DmTurn;
}

interface SessionDocView {
  _id: string;
  status: string;
  adventure?: { title: string };
  player?: PlayerState;
  currentExercise?: CurrentExercise;
  completedExercises?: string[];
  startedAt?: string;
}

interface SessionPollData {
  session: SessionDocView;
  turns: TurnRecord[];
}

const STILL_KEY = "dd-still-orb";

const DURATIONS = [
  { minutes: 10 as const, name: "Squire's Trial", mood: "calm", energy: 0.25 },
  { minutes: 20 as const, name: "Deep Delve", mood: "mysterious", energy: 0.45 },
  { minutes: 30 as const, name: "Dragon's Vigil", mood: "danger", energy: 0.65 },
];

function prefersStill(): boolean {
  try {
    return (
      window.localStorage.getItem(STILL_KEY) === "1" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

function orbStateFor(micState: MicState): OrbState {
  if (micState === "ERROR") return "error";
  if (micState === "DM_SPEAKING") return "speaking";
  if (micState === "LISTENING") return "listening";
  if (micState === "IDLE") return "idle";
  return "thinking";
}

function orbCaptionFor(micState: MicState): string {
  switch (micState) {
    case "LISTENING":
      return "The orb listens. Speak your action.";
    case "PROCESSING":
      return "The Dungeon Master consults the dark.";
    case "DM_SPEAKING":
      return "The Dungeon Master speaks.";
    case "ERROR":
      return "The connection wavers. Tap Speak or type below.";
    default:
      return "Tap Speak to address the Dungeon Master.";
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "Past delve";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Past delve";
  }
}

function spokenTextForTurn(turn: DmTurn): string {
  const parts = [turn.narration.trim()];
  const prompt = turn.action?.prompt?.trim();
  if (prompt && prompt !== turn.narration.trim()) parts.push(prompt);
  return parts.join(" ");
}

export function AdventureRoot() {
  return (
    <>
      <Show when="signed-out">
        <LandingPage />
      </Show>
      <Show when="signed-in">
        <AdventureApp />
      </Show>
    </>
  );
}

function AdventureApp() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const userId = user?.id ?? "";
  const heroName =
    user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Hero";

  const [view, setView] = useState<View>("gate");
  const [duration, setDuration] = useState<10 | 20 | 30>(10);
  const [selectedTrial, setSelectedTrial] = useState<10 | 20 | 30 | null>(null);
  const [isAwakening, setIsAwakening] = useState(false);
  const [session, setSession] = useState<SessionView | null>(null);
  const [input, setInput] = useState("I am ready");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [micState, setMicState] = useState<MicState>("IDLE");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [aiDegraded, setAiDegraded] = useState<string | null>(null);
  const [mood, setMood] = useState("mysterious");
  const [muted, setMuted] = useState(false);
  const [stillOrb, setStillOrb] = useState<boolean>(prefersStill);
  const [sideOpen, setSideOpen] = useState(false);
  const [history, setHistory] = useState<SessionDocView[]>([]);
  const [replay, setReplay] = useState<SessionPollData | null>(null);
  const [replayTitle, setReplayTitle] = useState("");

  const sessionRef = useRef<SessionView | null>(null);
  sessionRef.current = session;
  const submittingRef = useRef(false);
  const submittedTextRef = useRef<string | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const listenRetriesRef = useRef(0);
  const pollGenRef = useRef(0);
  const lastTurnCountRef = useRef(0);
  const lastEnvRef = useRef("dungeon");
  const energyRef = useRef(0);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const envAudioRef = useRef<EnvironmentAudio | null>(null);
  if (!envAudioRef.current) envAudioRef.current = new EnvironmentAudio();
  const sfxRef = useRef<SfxEngine | null>(null);
  if (!sfxRef.current) sfxRef.current = new SfxEngine();
  const gateRefs = useRef(DURATIONS.map((d) => ({ current: d.energy })));

  useEffect(() => {
    setMuted(sfxRef.current?.muted ?? false);
  }, []);

  // Scope client error reports to the signed-in hero.
  useEffect(() => {
    try {
      Sentry.setUser(userId ? { id: userId } : null);
    } catch {
      // Observability must never break gameplay.
    }
  }, [userId]);

  function push(msg: string): void {
    setLog((l) => [...l.slice(-50), msg]);
  }

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getTokenRef.current();
    if (!token) throw new Error("Your sign-in expired. Refresh and sign in again.");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, []);

  async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    return data;
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: await authHeaders(),
    });
    const data = (await res.json().catch(() => ({}))) as T & {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    return data;
  }

  const isSessionActive = useCallback(
    (): boolean => sessionRef.current?.status === "active",
    [],
  );

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (!userId) return;
    try {
      const data = await getJson<{ sessions: SessionDocView[] }>(
        `/api/v1/users/${userId}/sessions`,
      );
      setHistory(data.sessions ?? []);
    } catch (err) {
      push(`Chronicle note: ${(err as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const handleTtsEnd = useCallback((): void => {
    envAudioRef.current?.restore();
    const current = sessionRef.current;
    if (!current || current.status !== "active") {
      setMicState("IDLE");
      return;
    }
    beginListeningRef.current?.();
  }, []);

  const handleTtsError = useCallback((message: string): void => {
    push(`TTS note: ${message}`);
  }, []);

  const tts = useSpeechSynthesis({
    onEnd: handleTtsEnd,
    onError: handleTtsError,
  });

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const vEnergy = tts.getVoiceEnergy();
      const aEnergy = envAudioRef.current?.getEnergy() ?? 0;
      // While speaking, voice energy reacts dynamically to every word spoken by the DM.
      // While active and silent, environmental audio energy provides the bed.
      energyRef.current = Math.min(1, Math.max(vEnergy, aEnergy));

      // Living breathing pulsation for gate crystals so they feel alive
      const now = performance.now() * 0.001;
      gateRefs.current.forEach((ref, idx) => {
        const base = DURATIONS[idx]?.energy ?? 0.3;
        ref.current = Math.min(
          1,
          Math.max(0.1, base + 0.12 * Math.sin(now * 2.2 + idx * 2.0)),
        );
      });

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tts]);

  const pollSession = useCallback(
    async (
      sessionId: string,
      isDone: (data: SessionPollData) => boolean,
      timeoutMs: number,
    ): Promise<SessionPollData | null> => {
      const gen = pollGenRef.current;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (pollGenRef.current !== gen) return null;
        try {
          const data = await getJson<SessionPollData>(
            `/api/v1/sessions/${sessionId}`,
          );
          if (isDone(data)) return data;
          if (data.session.status === "completed") return data;
        } catch (err) {
          push(`Poll note: ${(err as Error).message}`);
        }
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const adoptTurn = useCallback(
    (rec: TurnRecord, doc: SessionDocView, totalTurns: number): void => {
      const turn = rec.dmOutput;
      if (!turn) return;
      lastTurnCountRef.current = totalTurns;
      const scene = turn.scene?.environment ?? "dungeon";
      lastEnvRef.current = scene;
      if (turn.mood) setMood(turn.mood);
      sfxRef.current?.play(turn.scene?.soundEffects);
      const actionExercise =
        turn.action?.type === "exercise" && turn.action.exerciseId
          ? {
              exerciseId: turn.action.exerciseId,
              reps: turn.action.reps,
              durationSeconds: turn.action.durationSeconds,
              completed: false,
            }
          : undefined;
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: doc.status,
              player: doc.player ?? prev.player,
              currentExercise: doc.currentExercise ?? actionExercise,
              lastNarration: turn.narration,
              lastPrompt: turn.action?.prompt,
              lastScene: scene,
              isExerciseTurn: turn.action?.type === "exercise",
              turnCount: totalTurns,
            }
          : prev,
      );
      push(`DM: ${turn.narration}`);
      if (turn.ai?.degraded) {
        const note = `Live AI unreachable (${turn.ai.reason ?? "unknown error"}) — playing fallback dialogue. Check the API terminal.`;
        setAiDegraded(note);
        push(`AI note: ${note}`);
      } else {
        setAiDegraded(null);
      }
      if (doc.status !== "active") {
        finishSessionLocallyRef.current?.("The adventure has ended.");
        return;
      }
      speakTurnRef.current?.(spokenTextForTurn(turn), scene);
    },
    [],
  );

  const finishSessionLocallyRef = useRef<((message: string) => void) | null>(null);

  const submitTranscript = useCallback(
    async (text: string): Promise<void> => {
      const current = sessionRef.current;
      if (!current || current.status !== "active") return;
      if (submittingRef.current) return;
      if (submittedTextRef.current === `${current.sessionId}:${text}`) return;
      submittingRef.current = true;
      submittedTextRef.current = `${current.sessionId}:${text}`;
      setMicState("PROCESSING");
      push(`You: ${text}`);
      try {
        await postJson<{ accepted: boolean }>(
          `/api/v1/sessions/${current.sessionId}/response`,
          { text },
        );
        const baseline = lastTurnCountRef.current;
        const data = await pollSession(
          current.sessionId,
          (d) => d.turns.length > baseline,
          300000,
        );
        if (!data) {
          push("The Dungeon Master is taking too long. Tap the mic to retry.");
          setMicState("ERROR");
          return;
        }
        const rec = data.turns[data.turns.length - 1];
        if (rec) adoptTurn(rec, data.session, data.turns.length);
      } catch (err) {
        push(`Error: ${(err as Error).message}`);
        setMicState("ERROR");
        setVoiceNotice("Could not reach the Dungeon Master. Tap the mic to try again, or type below.");
      } finally {
        submittingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adoptTurn, pollSession],
  );

  const handleFinalTranscript = useCallback(
    (text: string): void => {
      listenRetriesRef.current = 0;
      sttRef.current?.stopListening();
      void submitTranscript(text);
    },
    [submitTranscript],
  );

  const stt = useSpeechRecognition({ onFinal: handleFinalTranscript });
  const sttRef = useRef(stt);
  sttRef.current = stt;

  const beginListening = useCallback((): void => {
    if (!isSessionActive()) return;
    if (!sttRef.current.supported) {
      setMicState("IDLE");
      return;
    }
    tts.stop();
    sttRef.current.resetTranscript();
    sttRef.current.startListening();
    setMicState("LISTENING");
    setVoiceNotice(null);
  }, [isSessionActive, tts]);

  const beginListeningRef = useRef<(() => void) | null>(null);
  beginListeningRef.current = beginListening;

  const speakTurn = useCallback(
    (text: string, scene?: string): void => {
      if (!isSessionActive()) return;
      sttRef.current?.stopListening();
      if (scene) envAudioRef.current?.start(scene);
      envAudioRef.current?.duck();
      setMicState("DM_SPEAKING");
      tts.speak(text);
    },
    [isSessionActive, tts],
  );

  const speakTurnRef = useRef<((text: string, scene?: string) => void) | null>(
    null,
  );
  speakTurnRef.current = speakTurn;

  useEffect(() => {
    if (!stt.error) return;
    if (stt.error === "aborted") return;
    const transient = stt.error === "no-speech" || stt.error === "network";
    if (
      transient &&
      listenRetriesRef.current < 1 &&
      sessionRef.current?.status === "active"
    ) {
      listenRetriesRef.current += 1;
      push(`Mic hiccup (${stt.error}) — retrying…`);
      retryTimerRef.current = window.setTimeout(() => {
        beginListeningRef.current?.();
      }, 900);
      return;
    }
    setMicState((prev) => (prev === "LISTENING" ? "IDLE" : prev));
    setVoiceNotice(stt.errorMessage);
  }, [stt.error, stt.errorMessage]);

  const clearSessionTimer = useCallback((): void => {
    if (sessionTimerRef.current !== null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const finishSessionLocally = useCallback(
    (message: string): void => {
      clearSessionTimer();
      pollGenRef.current += 1;
      sttRef.current?.stopListening();
      tts.stop();
      envAudioRef.current?.stop();
      submittingRef.current = false;
      energyRef.current = 0;
      setMicState("IDLE");
      setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
      push(message);
      void refreshHistory();
    },
    [clearSessionTimer, tts, refreshHistory],
  );
  finishSessionLocallyRef.current = finishSessionLocally;

  useEffect(
    () => () => {
      pollGenRef.current += 1;
      if (sessionTimerRef.current !== null) {
        window.clearTimeout(sessionTimerRef.current);
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      sttRef.current?.stopListening();
      envAudioRef.current?.stop(0.2);
    },
    [],
  );

  async function start(minutes: 10 | 20 | 30): Promise<void> {
    stt.stopListening();
    tts.stop();
    envAudioRef.current?.stop(0.2);
    clearSessionTimer();
    submittingRef.current = false;
    submittedTextRef.current = null;
    listenRetriesRef.current = 0;
    pollGenRef.current += 1;
    lastTurnCountRef.current = 0;
    setAiDegraded(null);
    const trialMood =
      minutes === 10 ? "calm" : minutes === 20 ? "mysterious" : "danger";
    setMood(trialMood);
    setDuration(minutes);
    setSelectedTrial(minutes);
    setIsAwakening(true);
    setBusy(true);
    setMicState("PROCESSING");
    try {
      const data = await postJson<{
        sessionId: string;
        status: string;
        adventure: { title: string };
        opening?: DmTurn;
      }>("/api/v1/sessions", { userId, durationMinutes: minutes });
      setSession({
        sessionId: data.sessionId,
        status: data.status,
        adventure: data.adventure,
      });
      push(`Adventure started: ${data.adventure.title}`);
      sessionTimerRef.current = window.setTimeout(
        () => {
          void endSession(true);
        },
        minutes * 60 * 1000,
      );
      // Once session is generated, transition seamlessly to the live stage
      setView("live");
      setIsAwakening(false);

      if (data.opening?.narration) {
        adoptTurn(
          { turnNumber: 1, dmOutput: data.opening },
          { _id: data.sessionId, status: data.status },
          1,
        );
      } else {
        push("The mists gather… (waiting for the Dungeon Master)");
        const first = await pollSession(
          data.sessionId,
          (d) => d.turns.length > 0,
          240000,
        );
        if (!first || first.turns.length === 0) {
          push("The Dungeon Master is taking too long. Choose an orb to retry.");
          setMicState("ERROR");
          return;
        }
        const rec = first.turns[first.turns.length - 1]!;
        adoptTurn(rec, first.session, first.turns.length);
      }
    } catch (err) {
      push(`Error: ${(err as Error).message}`);
      setMicState("ERROR");
      setIsAwakening(false);
      setSelectedTrial(null);
    } finally {
      setBusy(false);
    }
  }

  async function sendTyped(): Promise<void> {
    const text = input.trim();
    if (!text || submittingRef.current) return;
    stt.stopListening();
    setInput("");
    await submitTranscript(text);
  }

  async function completeExercise(): Promise<void> {
    const current = sessionRef.current;
    if (!current || current.status !== "active") return;
    if (!current.currentExercise || current.currentExercise.completed) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    const exerciseId = current.currentExercise.exerciseId;
    try {
      const data = await postJson<{
        accepted: boolean;
        xpAwarded?: number;
      }>(`/api/v1/sessions/${current.sessionId}/exercise/complete`, {
        exerciseId,
      });
      if (data.xpAwarded !== undefined) {
        setSession((prev) =>
          prev && prev.currentExercise
            ? {
                ...prev,
                currentExercise: { ...prev.currentExercise, completed: true },
                isExerciseTurn: false,
              }
            : prev,
        );
        push(`Exercise complete (+${data.xpAwarded} XP)`);
        if (isSessionActive()) beginListening();
        return;
      }
      const done = await pollSession(
        current.sessionId,
        (d) =>
          (d.session.completedExercises ?? []).includes(exerciseId) ||
          d.session.currentExercise?.completed === true,
        120000,
      );
      if (!done) {
        push("Exercise confirmation is taking too long — it may still land.");
        return;
      }
      setSession((prev) =>
        prev
          ? {
              ...prev,
              player: done.session.player ?? prev.player,
              currentExercise: done.session.currentExercise ?? prev.currentExercise,
              isExerciseTurn: false,
            }
          : prev,
      );
      push("Exercise complete — well done, hero.");
      if (isSessionActive()) beginListening();
    } catch (err) {
      push(`Error: ${(err as Error).message}`);
    } finally {
      submittingRef.current = false;
    }
  }

  async function endSession(expired = false): Promise<void> {
    const current = sessionRef.current;
    clearSessionTimer();
    stt.stopListening();
    tts.stop();
    envAudioRef.current?.stop();
    submittingRef.current = false;
    if (!current) {
      setMicState("IDLE");
      return;
    }
    try {
      const data = await postJson<{
        accepted?: boolean;
        session?: { status?: string };
      }>(`/api/v1/sessions/${current.sessionId}/end`);
      if (data.session?.status === "completed") {
        setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
      } else {
        await pollSession(
          current.sessionId,
          (d) => d.session.status === "completed",
          60000,
        );
        setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
      }
    } catch (err) {
      push(`End note: ${(err as Error).message}`);
      setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
    }
    setMicState("IDLE");
    push(expired ? "Time is up — the adventure is complete." : "Session completed.");
    void refreshHistory();
  }

  async function openReplay(doc: SessionDocView): Promise<void> {
    try {
      const data = await getJson<SessionPollData>(
        `/api/v1/sessions/${doc._id}`,
      );
      setReplay(data);
      setReplayTitle(doc.adventure?.title ?? "Past delve");
      setView("replay");
      setSideOpen(false);
    } catch (err) {
      push(`Replay note: ${(err as Error).message}`);
    }
  }

  function toggleMic(): void {
    if (!isSessionActive()) return;
    if (micState === "LISTENING") {
      stt.stopListening();
      setMicState("IDLE");
      return;
    }
    if (micState === "DM_SPEAKING") {
      tts.stop();
      envAudioRef.current?.restore();
    }
    beginListening();
  }

  function toggleMute(): void {
    const next = !muted;
    setMuted(next);
    sfxRef.current?.setMuted(next);
    if (next) {
      envAudioRef.current?.stop(0.2);
    } else if (isSessionActive()) {
      envAudioRef.current?.start(lastEnvRef.current);
    }
  }

  function toggleStill(): void {
    const next = !stillOrb;
    setStillOrb(next);
    try {
      window.localStorage.setItem(STILL_KEY, next ? "1" : "0");
    } catch {
      // Persistence is a nicety.
    }
  }

  function backToGate(): void {
    pollGenRef.current += 1;
    clearSessionTimer();
    stt.stopListening();
    tts.stop();
    envAudioRef.current?.stop(0.2);
    submittingRef.current = false;
    energyRef.current = 0;
    setSession(null);
    setReplay(null);
    setSelectedTrial(null);
    setIsAwakening(false);
    setMicState("IDLE");
    setVoiceNotice(null);
    setAiDegraded(null);
    setView("gate");
    void refreshHistory();
  }

  const completed = session?.status === "completed";
  const showTextFallback =
    !stt.supported || stt.error === "unsupported" || stt.error === "permission-denied";
  const liveOrb: OrbState = completed ? "idle" : orbStateFor(micState);

  return (
    <div className="adv-layout">
      {sideOpen && (
        <button
          className="adv-scrim"
          aria-label="Close chronicle"
          onClick={() => setSideOpen(false)}
        />
      )}
      <aside className="adv-side" data-open={sideOpen} aria-label="Chronicle">
        <div className="adv-side-inner">
          <div className="adv-side-head">
            <h2 className="adv-side-title">Chronicle</h2>
            <UserButton />
          </div>
          <p className="chronicle-empty">
            {heroName}, your past delves live here, kept in the vault.
          </p>
          {history.length === 0 ? (
            <p className="chronicle-empty">
              No delves yet. Choose a crystal to begin your first.
            </p>
          ) : (
            <ul className="chronicle-list">
              {history.map((doc) => (
                <li key={doc._id}>
                  <button
                    className="chronicle-item"
                    aria-current={replay !== null && replayTitle === (doc.adventure?.title ?? "") && view === "replay" ? "true" : undefined}
                    onClick={() => void openReplay(doc)}
                  >
                    <span className="chronicle-item-title">
                      {doc.adventure?.title ?? "Untitled delve"}
                    </span>
                    <span className="chronicle-item-meta">
                      {formatDate(doc.startedAt)} · {doc.status}
                      {typeof doc.player?.xp === "number" ? ` · ${doc.player.xp} XP` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="adv-main">
        <header className="adv-bar">
          <button
            className="icon-chip adv-menu-chip"
            aria-label="Open chronicle"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen(true)}
          >
            ☰
          </button>
          <div className="adv-titles">
            <h1 className="adv-title">
              {view === "replay"
                ? replayTitle
                : (session?.adventure.title ?? "DungeonsDaily")}
            </h1>
            <p className="adv-status">
              {view === "live" && session
                ? session.status === "active"
                  ? `${session.lastScene ? `${session.lastScene} · ` : ""}Turn ${session.turnCount ?? 0}`
                  : "Adventure complete"
                : view === "replay"
                  ? "Reading a past delve"
                  : `${heroName} · choose a crystal`}
            </p>
          </div>
          <div className="adv-tools">
            <button
              className="icon-chip"
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button
              className="icon-chip"
              onClick={toggleStill}
              aria-pressed={stillOrb}
              aria-label={stillOrb ? "Animate orb" : "Still orb"}
            >
              ✦
            </button>
          </div>
        </header>

        {view === "gate" && (
          <>
            <p className="adv-lede">
              {isAwakening
                ? "The crystal awakens. Deep within, the ancient mists swirl..."
                : "Three trials hum in the dark. Touch a crystal to wake its trial and begin."}
            </p>
            <div
              className={`adv-trio ${isAwakening ? "adv-trio-awakening" : ""}`}
              role="group"
              aria-label="Choose a trial length"
            >
              {DURATIONS.map((d, i) => {
                const isSelected = selectedTrial === d.minutes;
                const isVanished = isAwakening && !isSelected;

                return (
                  <button
                    key={d.minutes}
                    className={`orb-pick ${
                      isSelected ? "orb-pick-enlarged" : ""
                    } ${isVanished ? "orb-pick-vanish" : ""}`}
                    disabled={busy && !isSelected}
                    onClick={() => {
                      if (!busy && !isAwakening) {
                        void start(d.minutes);
                      }
                    }}
                    aria-label={`Begin ${d.minutes} minute adventure, ${d.name}`}
                  >
                    <span className="orb-pick-canvas" aria-hidden="true">
                      <OrbCanvas
                        state={isSelected ? "awakening" : "thinking"}
                        mood={d.mood}
                        trial={d.minutes}
                        energyRef={
                          isSelected
                            ? energyRef
                            : (gateRefs.current[i] as React.MutableRefObject<number>)
                        }
                        still={stillOrb}
                        variant="crystal"
                        enlarged={isSelected}
                        awakening={isSelected}
                        label={`${d.name} crystal, ${d.minutes} minute trial`}
                      />
                    </span>
                    <span className="orb-pick-name">{d.name}</span>
                    <span className="orb-pick-mins">{d.minutes} min</span>

                    {isSelected && isAwakening && (
                      <div className="orb-awakening-panel" role="status">
                        <span className="orb-awakening-title">
                          Awakening {d.name}
                        </span>
                        <span className="orb-awakening-subtitle">
                          Waking the Dungeon Master... Channeling the mists into the crystal.
                        </span>
                        <span className="orb-awakening-pulse">
                          <span className="orb-pulse-dot" />
                          Resonating with your spirit...
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {view === "live" && session && (
          <>
            <div className="adv-stage">
              <OrbCanvas
                state={liveOrb}
                mood={mood}
                trial={duration}
                energyRef={energyRef}
                still={stillOrb}
                variant="crystal"
                enlarged={true}
                label={`Dungeon Master crystal orb: ${orbCaptionFor(micState)}`}
              />
              <p className="adv-caption" aria-live="polite">
                {!completed && orbCaptionFor(micState)}
              </p>
            </div>

            {session.player && (
              <p className="adv-stats" aria-label="Hero stats">
                <span>Level <strong>{session.player.level}</strong></span>
                <span><strong>{session.player.xp}</strong> XP</span>
                <span><strong>{session.player.health}</strong> HP</span>
              </p>
            )}

            {session.lastNarration && (
              <p className="adv-narration">{session.lastNarration}</p>
            )}
            {session.lastPrompt && (
              <p className="adv-prompt">{session.lastPrompt}</p>
            )}

            {aiDegraded && !completed && (
              <p className="adv-notice" role="status">⚠️ {aiDegraded}</p>
            )}

            {session.isExerciseTurn && session.currentExercise && !completed && (
              <div className="adv-exercise" role="region" aria-label="Active Exercise Trial">
                <p className="adv-exercise-name">
                  ⚔️ {session.currentExercise.exerciseId.replace(/_/g, " ")}
                </p>
                <p className="adv-exercise-detail">
                  {session.currentExercise.reps
                    ? `${session.currentExercise.reps} repetitions required`
                    : ""}
                  {session.currentExercise.durationSeconds
                    ? `Hold for ${session.currentExercise.durationSeconds} seconds`
                    : ""}
                </p>
                <button
                  className="adv-btn adv-btn-speak adv-exercise-complete"
                  onClick={() => void completeExercise()}
                  disabled={busy}
                >
                  Complete exercise
                </button>
                <p className="adv-exercise-action-hint">
                  Or speak your action (e.g. &ldquo;10 reps done&rdquo;) and let
                  the Dungeon Master answer.
                </p>
              </div>
            )}

            {micState === "PROCESSING" && (
              <div className="adv-dm-thinking-panel" role="status" aria-live="polite">
                <div className="adv-dm-thinking-header">
                  <span className="adv-dm-thinking-icon">✦</span>
                  <span className="adv-dm-thinking-title">The Dungeon Master is thinking...</span>
                  <span className="adv-dm-thinking-dot-pulse" />
                </div>
                <p className="adv-dm-thinking-subtext">
                  Consulting the dark mists and weaving the consequence of your action.
                </p>
              </div>
            )}

            {!completed && (
              <>
                {(micState === "LISTENING" && (stt.interimTranscript || stt.transcript)) && (
                  <p className="adv-prompt">
                    Hearing: {stt.interimTranscript || stt.transcript}
                  </p>
                )}
                <div className="adv-dock">
                  <div className="adv-action-row">
                    <button
                      className={`adv-btn adv-btn-speak ${micState === "LISTENING" ? "adv-btn-listening" : ""}`}
                      onClick={toggleMic}
                      disabled={micState === "PROCESSING" || !stt.supported}
                      aria-label={micState === "LISTENING" ? "Stop microphone" : "Speak to Dungeon Master"}
                    >
                      <span>{micState === "LISTENING" ? "⏹ Stop" : "🎙 Speak"}</span>
                    </button>
                    <div className="adv-input-wrap">
                      <input
                        className="adv-input adv-input-large"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void sendTyped();
                        }}
                        placeholder="Type your action (or tap Speak)..."
                        aria-label="Type your response"
                      />
                      <button
                        className="adv-btn adv-btn-send"
                        onClick={() => void sendTyped()}
                        disabled={busy || !input.trim()}
                        aria-label="Send action"
                      >
                        ➤
                      </button>
                    </div>
                  </div>
                  <div className="adv-subdock-row">
                    <button
                      className="adv-btn adv-btn-end"
                      onClick={() => void endSession(false)}
                    >
                      End session
                    </button>
                  </div>
                  {voiceNotice && <p className="adv-notice" role="status">{voiceNotice}</p>}
                  {showTextFallback && (
                    <p className="adv-notice" role="status">
                      {stt.errorMessage ??
                        "Microphone access is unavailable. Type your response in the box above."}
                    </p>
                  )}
                </div>
              </>
            )}

            {completed && (
              <>
                <h2 className="adv-display-gold">Adventure complete</h2>
                {session.player && (
                  <p className="adv-stats">
                    <span>Level <strong>{session.player.level}</strong></span>
                    <span><strong>{session.player.xp}</strong> XP</span>
                    <span><strong>{session.player.health}</strong> HP</span>
                  </p>
                )}
                <button className="adv-btn adv-btn-speak" onClick={backToGate}>
                  Return to the crystals
                </button>
              </>
            )}
          </>
        )}

        {view === "replay" && replay && (
          <>
            {replay.turns.length === 0 ? (
              <p className="adv-prompt">This delve left no echoes.</p>
            ) : (
              <div>
                {replay.turns.map((t) => (
                  <div className="replay-turn" key={t.turnNumber}>
                    {t.userInput?.text && (
                      <p className="replay-you">You: {t.userInput.text}</p>
                    )}
                    {t.dmOutput?.narration && (
                      <p className="replay-dm">{t.dmOutput.narration}</p>
                    )}
                    {t.dmOutput?.action?.prompt && (
                      <p className="replay-you">{t.dmOutput.action.prompt}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button className="adv-btn adv-btn-quiet" onClick={backToGate}>
              Return to the crystals
            </button>
          </>
        )}

        <details className="adv-disclosure">
          <summary>Adventure log</summary>
          <pre className="adv-log">{log.join("\n")}</pre>
        </details>
      </div>
    </div>
  );
}
