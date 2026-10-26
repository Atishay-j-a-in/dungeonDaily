import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { env } from "../../config/env.js";

// Single place where the model is configured. Change GEMMA_MODEL to swap
// models — nothing else in the codebase names a model.
//
// Google direct (ai-sdk.dev/providers/ai-sdk-providers/google):
// `google(GEMMA_MODEL_ID)` with an id such as `gemma-4-26b-a4b-it`
// (ai.google.dev/gemma/docs/core/gemma_on_gemini_api). The Google provider
// reads GOOGLE_GENERATIVE_AI_API_KEY from the environment automatically.
//
// Do NOT silently switch to another provider if a Gemma ID stops working —
// report the incompatibility instead. Keys are never passed around, never
// logged, and never sent to the frontend.

export const GEMMA_MODEL_ID: string = env.gemmaModel;

export type GemmaProvider = "google";

export const GEMMA_PROVIDER: GemmaProvider = "google";

/** Short provider label for logs/traces. */
export function providerLabel(): string {
  return "google";
}

export function getGemmaModel(): LanguageModel {
  if (!env.googleApiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set — live Dungeon Master is unavailable. " +
        "Add GOOGLE_GENERATIVE_AI_API_KEY to .env (https://aistudio.google.com).",
    );
  }
  // @ai-sdk/google may resolve a different @ai-sdk/provider instance than
  // `ai` — structurally identical LanguageModelV4, nominal type mismatch.
  return google(GEMMA_MODEL_ID) as unknown as LanguageModel;
}
