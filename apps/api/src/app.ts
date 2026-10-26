import cors from "cors";
import express from "express";
import morgan from "morgan";
import { clerkMiddleware, requireAuth } from "@clerk/express";
import { getDb } from "./db/mongo.js";
import { env, hasGemma, hasElevenLabs } from "./config/env.js";
import { sessionRouter, userRouter } from "./modules/sessions/session.routes.js";
import { voiceRouter } from "./modules/voice/voice.controller.js";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.js";

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));
  // Clerk verifies the session token on every request (reads
  // CLERK_SECRET_KEY from the environment). Health stays public so
  // deploys and uptime checks never need a login.
  app.use(clerkMiddleware());

  app.get("/api/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        // MongoDB: connected to Atlas, or in-memory fallback when unconfigured.
        mongo: getDb() ? "connected" : "memory-fallback",
        // DM narration: Google provider (Gemma) or the deterministic Fake DM.
        ai: hasGemma ? `live:${env.gemmaModel}` : "fake-deterministic",
        // DM voice + SFX + environment music via ElevenLabs, or silent.
        voice: hasElevenLabs
          ? `elevenlabs:${env.elevenlabsModelId}`
          : "unavailable",
      },
    });
  });

  // History is per-user and writes are attributed server-side: every route
  // below requires a login, and handlers take the user id from the verified
  // token, never from client input.
  app.use("/api/v1/sessions", requireAuth(), sessionRouter());
  app.use("/api/v1/users", requireAuth(), userRouter());
  app.use("/api/v1/voice", voiceRouter());

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}
