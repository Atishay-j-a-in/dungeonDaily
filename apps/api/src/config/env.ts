import dotenv from "dotenv";
import path from "node:path";

// Precedence (audit #4): monorepo-root `.env`, then root `.env.local`
// (ElevenLabs CLI onboarding key), then API-local `.env`, then the bare
// process environment. dotenv does NOT override already-loaded values by
// default, so later files must use `override: true`.
const rootDir = path.resolve(process.cwd(), "../..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
dotenv.config();

function required(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function parsePort(raw: string, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(
      `[env] Invalid PORT=${JSON.stringify(raw)} — falling back to ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

export const env = {
  nodeEnv: required("NODE_ENV", "development"),
  port: parsePort(required("PORT", "4000"), 4000),
  mongodbUri: required("MONGODB_URI", ""),
  mongodbDbName: required("MONGODB_DB_NAME", "dungeonsdaily"),
  // Google provider key (@ai-sdk/google reads GOOGLE_GENERATIVE_AI_API_KEY
  // automatically). GEMMA_API_KEY is accepted as an alias for the same key.
  // Server-side only — never expose to the frontend.
  googleApiKey: required(
    "GOOGLE_GENERATIVE_AI_API_KEY",
    required("GEMMA_API_KEY", ""),
  ),
  // Model id on Google's Gemma endpoint.
  gemmaModel: required("GEMMA_MODEL", "gemma-4-31b-it"),
  // ElevenLabs: DM voice (TTS), one-shot SFX, and environment music.
  // Key lives in root `.env.local` (CLI onboarding) — server-side only.
  elevenlabsApiKey: required("ELEVENLABS_API_KEY", ""),
  // George — narrative male voice suited to a Dungeon Master.
  elevenlabsVoiceId: required("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
  elevenlabsModelId: required("ELEVENLABS_MODEL_ID", "eleven_v4"),
  elevenlabsSfxModelId: required(
    "ELEVENLABS_SFX_MODEL_ID",
    "eleven_text_to_sound_v2",
  ),
  elevenlabsMusicModelId: required(
    "ELEVENLABS_MUSIC_MODEL_ID",
    "music_v2_5",
  ),
  sentryDsn: required("SENTRY_DSN", ""),
  sentryEnvironment: required("SENTRY_ENVIRONMENT", "development"),
};

export const hasMongo = env.mongodbUri.length > 0;
// Live DM needs the Google key — without it the deterministic Fake DM
// keeps the game fully playable.
export const hasGemma = env.googleApiKey.length > 0;
// ElevenLabs needs only the API key — voice/model fall back to defaults.
export const hasElevenLabs = env.elevenlabsApiKey.length > 0;
export const hasSentry = env.sentryDsn.length > 0;
