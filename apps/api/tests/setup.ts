// Unit tests must be hermetic: never call real Gemma/ElevenLabs/Mongo.
// The API falls back to the deterministic Fake DM + in-memory store when
// keys are absent, so force that here regardless of the developer's .env.
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.GEMMA_API_KEY = "";
process.env.ELEVENLABS_API_KEY = "";
process.env.ELEVENLABS_VOICE_ID = "";
process.env.MONGODB_URI = "";
process.env.SENTRY_DSN = "";
