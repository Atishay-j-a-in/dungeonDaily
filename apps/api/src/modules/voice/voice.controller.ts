import { Router } from "express";
import { SynthesizeRequestSchema } from "@dungeonsdaily/shared";
import { hasElevenLabs } from "../../config/env.js";
import { elevenLabsService } from "./elevenlabs.service.js";

// ElevenLabs-backed voice routes: DM narration (TTS), one-shot SFX, and
// environment music. Responses are raw audio (audio/mpeg). The API key
// never leaves the server. Failures return JSON errors — gameplay never
// depends on audio.

function sendAudio(res: import("express").Response, buf: Buffer): void {
  if (buf.length === 0) {
    res.status(502).json({
      error: {
        code: "AUDIO_UNAVAILABLE",
        message: "ElevenLabs returned empty audio",
      },
    });
    return;
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}

function sendAudioError(
  res: import("express").Response,
  err: unknown,
): void {
  const code = (err as { code?: string }).code ?? "AUDIO_UNAVAILABLE";
  const status =
    code === "VALIDATION_ERROR"
      ? 400
      : code === "AUDIO_UNAVAILABLE" && !hasElevenLabs
        ? 503
        : 502;
  res.status(status).json({
    error: {
      code,
      message:
        err instanceof Error ? err.message : "Audio generation failed",
    },
  });
}

export function voiceRouter(): Router {
  const router = Router();

  // POST /api/v1/voice/synthesize { text } → audio/mpeg (DM voice)
  router.post("/synthesize", async (req, res) => {
    const parsed = SynthesizeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      });
    }
    try {
      const audio = await elevenLabsService.synthesize(parsed.data.text);
      return sendAudio(res, audio);
    } catch (err) {
      return sendAudioError(res, err);
    }
  });

  // GET /api/v1/voice/sfx/:id → audio/mpeg (allowlisted IDs only)
  router.get("/sfx/:id", async (req, res) => {
    try {
      const audio = await elevenLabsService.generateSfx(
        String(req.params.id ?? ""),
      );
      return sendAudio(res, audio);
    } catch (err) {
      return sendAudioError(res, err);
    }
  });

  // GET /api/v1/voice/music/:environment → audio/mpeg (looped bed)
  router.get("/music/:environment", async (req, res) => {
    try {
      const audio = await elevenLabsService.generateEnvironmentMusic(
        String(req.params.environment ?? ""),
      );
      return sendAudio(res, audio);
    } catch (err) {
      return sendAudioError(res, err);
    }
  });

  return router;
}
