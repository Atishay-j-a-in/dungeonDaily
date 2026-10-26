import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { env, hasElevenLabs } from "../../config/env.js";
import {
  ALLOWED_SFX,
  ENVIRONMENTS,
  type Environment,
} from "../game/scene-engine.js";
import type {
  MusicService,
  SoundEffectsService,
  TextToSpeechService,
} from "./voice.types.js";

// Text prompts for each allowlisted SFX ID. The DM only ever returns IDs
// from scene-engine.ts; this map turns them into ElevenLabs generations.
const SFX_PROMPTS: Record<string, string> = {
  sword_swing: "Fast metallic sword swing whoosh through the air",
  sword_hit: "Heavy sword strike impact on metal armor, cinematic",
  shield_hit: "Sword clanging off a steel shield, sharp metallic ring",
  footsteps: "Heavy armoured footsteps on stone dungeon floor",
  door_creak: "Old wooden dungeon door creaking open slowly",
  branch_snap: "Dry tree branch snapping sharply in a quiet forest",
  magic: "Magical spell cast shimmer with a sparkling arcane burst",
  monster_growl: "Deep monster growl rumbling in the dark",
  dragon_roar: "Enormous dragon roar echoing through a cavern",
  explosion: "Cinematic explosion blast with falling debris",
  coin: "Gold coin clink collected from a treasure hoard",
  level_up: "Triumphant fantasy level-up fanfare chime",
  heartbeat: "Tense slow heartbeat thump, close and muffled",
  thunder: "Sharp thunderclap with rolling rumble",
  wolf_growl: "Hostile wolf growl baring teeth",
  sword_clash: "Two swords clashing in a duel, bright steel ring",
  door: "Heavy door latch click and swing",
  fire: "Crackling campfire flames",
  victory_horn: "Heroic victory horn blast",
  heal_chime: "Soft healing chime with warm sparkle",
};

// Instrumental background beds per scene environment (looped client-side).
const MUSIC_PROMPTS: Record<Environment, string> = {
  forest: "Calm dark fantasy forest ambience music, soft wind, distant birds, gentle mysterious pads, instrumental loop",
  cave: "Eerie cave atmosphere music, low drones, distant water drips, dark ambient instrumental loop",
  dungeon: "Tense dungeon exploration music, deep bass pulses, distant chains, dark orchestral ambient loop",
  castle: "Grand castle hall music, regal strings, fireplace crackle undertones, medieval ambient instrumental loop",
  village: "Warm fantasy village evening music, light lute and flute, peaceful instrumental loop",
  battlefield: "Intense battlefield music, war drums, distant shouts, epic tense orchestral loop",
  mountain: "Windy mountain peak music, sparse cold strings, ambient instrumental loop",
  ruins: "Ancient ruins mystery music, hollow echoes, soft choir pads, dark ambient instrumental loop",
};

const CACHE_DIR = path.resolve(process.cwd(), ".cache/elevenlabs");
const TTS_MAX_CHARS = 4000;

function notConfigured(): Error & { code: string } {
  const err = new Error(
    "ElevenLabs not configured — set ELEVENLABS_API_KEY (root .env.local)",
  ) as Error & { code: string };
  err.code = "AUDIO_UNAVAILABLE";
  return err;
}

function upstreamFailure(kind: string, status: number, body: string): Error & {
  code: string;
} {
  const err = new Error(
    `ElevenLabs ${kind} failed (${status}): ${body.slice(0, 200)}`,
  ) as Error & { code: string };
  err.code = "AUDIO_UNAVAILABLE";
  return err;
}

async function streamToBuffer(
  stream: unknown,
): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof ArrayBuffer) return Buffer.from(stream);
  if (stream instanceof Uint8Array) return Buffer.from(stream);
  // Node-style readable (has pipe / async iterator)
  if (stream && typeof (stream as { pipe?: unknown }).pipe === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // Web ReadableStream
  if (stream && typeof (stream as { getReader?: unknown }).getReader === "function") {
    const reader = (
      stream as ReadableStream<Uint8Array>
    ).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  throw new Error("ElevenLabs returned an unsupported audio stream type");
}

async function cacheRead(key: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(CACHE_DIR, key));
  } catch {
    return null;
  }
}

async function cacheWrite(key: string, data: Buffer): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, key), data);
  } catch {
    // Cache is best-effort — a failed write must not fail the request.
  }
}

function sha8(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * ElevenLabs adapter for DM voice, sound effects, and environment music.
 * Route handlers must use this service, never call ElevenLabs directly.
 * TTS is per-turn (no cache). SFX and music are generated once per ID and
 * cached on disk under `apps/api/.cache/elevenlabs/`.
 */
export class ElevenLabsService
  implements TextToSpeechService, SoundEffectsService, MusicService
{
  private client: ElevenLabsClient | null = null;

  private getClient(): ElevenLabsClient {
    if (!hasElevenLabs) throw notConfigured();
    if (!this.client) {
      // SDK reads ELEVENLABS_API_KEY from the environment (loaded by env.ts).
      this.client = new ElevenLabsClient();
    }
    return this.client;
  }

  async synthesize(text: string): Promise<Buffer> {
    const trimmed = text.trim().slice(0, TTS_MAX_CHARS);
    if (!trimmed) return Buffer.alloc(0);
    const client = this.getClient();
    try {
      const audio = await client.textToSpeech.convert(env.elevenlabsVoiceId, {
        text: trimmed,
        modelId: env.elevenlabsModelId,
      });
      return await streamToBuffer(audio);
    } catch (err) {
      if ((err as { code?: string }).code === "AUDIO_UNAVAILABLE") throw err;
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      throw upstreamFailure(
        "TTS",
        status,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async generateSfx(id: string): Promise<Buffer> {
    if (!ALLOWED_SFX.includes(id)) {
      const err = new Error(`Unknown sound effect: ${id}`) as Error & {
        code: string;
      };
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    const prompt = SFX_PROMPTS[id];
    if (!prompt) {
      const err = new Error(`No SFX prompt for: ${id}`) as Error & {
        code: string;
      };
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    const cacheKey = `sfx-${id}-${sha8(prompt)}.mp3`;
    const cached = await cacheRead(cacheKey);
    if (cached) return cached;

    const client = this.getClient();
    try {
      const audio = await client.textToSoundEffects.convert({
        text: prompt,
        // SDK narrows model IDs to known literals; env may hold a newer id.
        modelId: env.elevenlabsSfxModelId as "eleven_text_to_sound_v2",
        durationSeconds: 2,
        promptInfluence: 0.4,
      });
      const buffer = await streamToBuffer(audio);
      await cacheWrite(cacheKey, buffer);
      return buffer;
    } catch (err) {
      if ((err as { code?: string }).code === "AUDIO_UNAVAILABLE") throw err;
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      throw upstreamFailure(
        "SFX",
        status,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async generateEnvironmentMusic(environment: string): Promise<Buffer> {
    if (!(ENVIRONMENTS as readonly string[]).includes(environment)) {
      const err = new Error(`Unknown environment: ${environment}`) as Error & {
        code: string;
      };
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    const envKey = environment as Environment;
    const prompt = MUSIC_PROMPTS[envKey];
    const cacheKey = `music-${envKey}-${sha8(prompt)}.mp3`;
    const cached = await cacheRead(cacheKey);
    if (cached) return cached;

    const client = this.getClient();
    try {
      const audio = await client.music.compose({
        prompt,
        musicLengthMs: 30_000,
        // SDK narrows model IDs to known literals; env may hold a newer id.
        modelId: env.elevenlabsMusicModelId as "music_v2_5",
        forceInstrumental: true,
      });
      const buffer = await streamToBuffer(audio);
      await cacheWrite(cacheKey, buffer);
      return buffer;
    } catch (err) {
      if ((err as { code?: string }).code === "AUDIO_UNAVAILABLE") throw err;
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      throw upstreamFailure(
        "music",
        status,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export const elevenLabsService = new ElevenLabsService();
