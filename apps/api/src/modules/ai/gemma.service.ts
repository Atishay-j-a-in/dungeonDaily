import { generateText, Output } from "ai";
import type { GoogleLanguageModelOptions } from "@ai-sdk/google";
import {
  DungeonMasterOutputSchema,
  type DungeonMasterInput,
  type DungeonMasterOutput,
} from "@dungeonsdaily/shared";
import { setTraceAttributes } from "../../observability/sentry.js";
import { GEMMA_MODEL_ID, getGemmaModel, providerLabel } from "./provider.js";
import { DUNGEON_MASTER_SYSTEM_PROMPT } from "./prompts/dungeon-master.js";
import type { DungeonMasterModel } from "./types.js";

// Gemma service: the ONLY place that calls the Gemma model. Route handlers
// and the game engine never touch the AI SDK or the Google API directly.
//
// Flow: Express Route → Session Service → Game Engine (validates state) →
// Gemma Service → Vercel AI SDK → Google API → Gemma.
//
// Implementation follows the official Google provider docs
// (ai-sdk.dev/providers/ai-sdk-providers/google):
// - generateText with `output: Output.object(...)` (generateObject is
//   deprecated in AI SDK v7).
// - `providerOptions.google.structuredOutputs: false`: Gemma 4 is not in
//   Google's structured-output support table, so the schema is NOT sent for
//   server-side enforcement. Google still receives the JSON MIME type, the
//   required schema is described in the prompt, and the SDK validates the
//   response client-side against our Zod schema.
// - A repair pass salvages prose-wrapped JSON before giving up.
//
// Gemma proposes narrative + exercise + audio cues as structured data. It
// NEVER mutates XP, health, level, session status, or the database — the
// deterministic game engine applies only what it validates.
//
// Conservative generation settings: consistency over randomness, bounded
// output (spoken aloud). Retry budget: the SDK retries ONCE internally
// (2 attempts) and dm-service performs a single repair retry — worst case
// ~4 provider calls per player turn. Do not raise maxRetries here without
// lowering one of the outer layers.
export class GemmaService implements DungeonMasterModel {
  async generateTurn(input: DungeonMasterInput): Promise<DungeonMasterOutput> {
    const startedAt = Date.now();
    try {
      const { output, usage, finishReason } = await generateText({
        model: getGemmaModel(),
        system: DUNGEON_MASTER_SYSTEM_PROMPT,
        prompt: buildUserMessage(input),
        temperature: 0.6,
        // Cap is headroom, not a target: Gemma 4 thinking traces consume
        // output budget (a one-line joke cost ~450 tokens), so a tight cap
        // truncates the narration into unparseable fragments.
        maxOutputTokens: 4096,
        maxRetries: 1,
        providerOptions: {
          google: {
            structuredOutputs: false,
          } satisfies GoogleLanguageModelOptions,
        },
        output: Output.object({
          schema: DungeonMasterOutputSchema,
          description:
            "A fresh Dungeon Master turn that advances the adventure. " +
            "The narration must differ from every previous narration.",
        }),
      });
      if (finishReason === "content-filter") {
        throw new Error("Gemma response blocked by content filter");
      }
      setTraceAttributes({
        model: GEMMA_MODEL_ID,
        durationMs: Date.now() - startedAt,
        success: true,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });
      return output;
    } catch (err) {
      const salvaged = salvageStructuredOutput(err);
      if (salvaged) {
        setTraceAttributes({
          model: GEMMA_MODEL_ID,
          durationMs: Date.now() - startedAt,
          success: true,
          repaired: true,
        });
        return salvaged;
      }
      setTraceAttributes({
        model: GEMMA_MODEL_ID,
        durationMs: Date.now() - startedAt,
        success: false,
      });
      const message = err instanceof Error ? err.message : String(err);
      // Never includes the API key — model id, finish reason, and a short
      // raw-text snippet so the API terminal shows what actually failed.
      throw new Error(
        `DM request failed provider=${providerLabel()} model=${GEMMA_MODEL_ID}${describeAiError(err)}: ${message}`,
      );
    }
  }
}

/**
 * Last-chance salvage: if the SDK error carries the raw model text
 * (prose-wrapped JSON), extract and validate it instead of failing.
 */
function salvageStructuredOutput(err: unknown): DungeonMasterOutput | null {
  if (typeof err !== "object" || err === null) return null;
  const text = (err as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  const json = extractJsonFromText(text);
  if (!json) return null;
  try {
    // Normalize near-miss enum values first (e.g. "mystery" → "mysterious"),
    // then validate strictly. Unknown values still fail → fallback.
    const parsed = DungeonMasterOutputSchema.safeParse(
      normalizeDmJson(JSON.parse(json)),
    );
    if (parsed.success) return parsed.data;
    // Local terminal diagnostics: which keys rejected the turn.
    console.warn(
      `[dm] schema issues: ${parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".") || "<root>"} (${i.message})`)
        .join("; ")}`,
    );
    return null;
  } catch {
    return null;
  }
}

function alias(value: unknown, mapping: Record<string, string>): unknown {
  if (typeof value !== "string") return value;
  return mapping[value.trim().toLowerCase()] ?? value;
}

function toInt(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }
  return value;
}

const MOOD_ALIASES: Record<string, string> = {
  mystery: "mysterious",
  mystical: "mysterious",
  eerie: "mysterious",
  discovery: "mysterious",
  battle: "combat",
  war: "combat",
  fight: "combat",
  victory: "victorious",
  triumph: "victorious",
  reward: "victorious",
  peace: "calm",
  peaceful: "calm",
  rest: "calm",
  scary: "danger",
  fear: "danger",
  peril: "danger",
  tension: "tense",
  urgency: "tense",
  urgent: "tense",
};

const EXPECTATION_ALIASES: Record<string, string> = {
  player_action: "user_speech",
  free_response: "user_speech",
  choice: "user_speech",
  speak: "user_speech",
  talk: "user_speech",
  listen: "user_speech",
  exercise: "exercise_completion",
};

const ENVIRONMENT_ALIASES: Record<string, string> = {
  dark_forest: "forest",
  deep_forest: "forest",
  woods: "forest",
  cavern: "cave",
  caverns: "cave",
  tunnel: "cave",
  crypt: "dungeon",
  tomb: "dungeon",
  fortress: "castle",
  keep: "castle",
  town: "village",
  hamlet: "village",
  field: "battlefield",
  warzone: "battlefield",
  peak: "mountain",
  pass: "mountain",
  temple: "ruins",
  shrine: "ruins",
};

/**
 * Map the model's near-miss vocabulary onto the strict game schema before
 * Zod validation. Anything still unknown fails validation → fallback.
 */
export function normalizeDmJson(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const root = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...root };
  out.mood = alias(root.mood, MOOD_ALIASES);
  out.responseExpectation = alias(root.responseExpectation, EXPECTATION_ALIASES);

  if (typeof root.scene === "object" && root.scene !== null) {
    const scene = root.scene as Record<string, unknown>;
    out.scene = {
      ...scene,
      environment: alias(scene.environment, ENVIRONMENT_ALIASES),
      ambientSounds: Array.isArray(scene.ambientSounds)
        ? scene.ambientSounds.filter((s): s is string => typeof s === "string")
        : scene.ambientSounds,
      soundEffects: Array.isArray(scene.soundEffects)
        ? scene.soundEffects.filter((s): s is string => typeof s === "string")
        : scene.soundEffects,
    };
  }

  if (typeof root.action === "object" && root.action !== null) {
    const action = root.action as Record<string, unknown>;
    let type = alias(action.type, {
      conversation: "narrate",
      talk: "narrate",
      story: "narrate",
      none: "narrate",
    });
    // "combat" means an exercise challenge when exercise data is present.
    if (type === "combat") {
      type = typeof action.exerciseId === "string" ? "exercise" : "narrate";
    }
    out.action = {
      ...action,
      type,
      reps: toInt(action.reps),
      durationSeconds: toInt(action.durationSeconds),
    };
  }

  if (typeof root.stateChanges === "object" && root.stateChanges !== null) {
    const changes = root.stateChanges as Record<string, unknown>;
    out.stateChanges = {
      ...changes,
      xp: toInt(changes.xp),
      healthDelta: toInt(changes.healthDelta),
    };
  }
  return out;
}

/**
 * One-line failure context for the API terminal: SDK finish reason plus a
 * short snippet of the raw model text (empty vs. non-JSON prose tells us
 * whether the model was cut off or ignored the format).
 */
function describeAiError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const record = err as { finishReason?: unknown; text?: unknown };
  const parts: string[] = [];
  if (typeof record.finishReason === "string") {
    parts.push(`finishReason=${record.finishReason}`);
  }
  if (typeof record.text === "string") {
    const snippet = record.text.replace(/\s+/g, " ").slice(0, 200);
    parts.push(snippet ? `text=${JSON.stringify(snippet)}` : "text=<empty>");
  }
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

/**
 * Extract a JSON object from model prose (fences, commentary around it).
 * Returns null when there is no JSON object to repair with.
 */
export function extractJsonFromText(text: string): string | null {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

export function buildUserMessage(input: DungeonMasterInput): string {
  const catalog = input.exerciseCatalog
    .map(
      (e) =>
        `- ${e.id} (${e.category}/${e.difficulty}${e.defaultReps ? `, ${e.defaultReps} reps` : ""}${e.defaultDurationSeconds ? `, ${e.defaultDurationSeconds}s` : ""})`,
    )
    .join("\n");

  // Bounded context only: current state + recent turns, never full history.
  // The schema is described here (not server-enforced for Gemma), the
  // response must be a single JSON object, and every turn must advance.
  return [
    `Session: ${input.durationMinutes} min, elapsed ${input.elapsedSeconds}s, chapter ${input.chapter}, turn ${input.turnNumber}, scene ${input.scene}.`,
    `Player: level ${input.player.level}, xp ${input.player.xp}, health ${input.player.health}.`,
    input.currentExercise
      ? `Current exercise: ${input.currentExercise.exerciseId} (completed=${input.currentExercise.completed}).`
      : "No current exercise.",
    `Completed exercises: ${input.completedExercises.join(", ") || "none"}.`,
    "Recent turns:",
    ...input.recentTurns.map((t) => `${t.speaker}: ${t.text}`),
    "",
    "Exercise catalog (choose exerciseId ONLY from this list):",
    catalog,
    "",
    "Respond with a single JSON object only — no markdown fences, no commentary — " +
      "with exactly these keys: narration (string, 1-4 spoken sentences), mood " +
      "(one of calm, mysterious, tense, combat, victorious, danger), scene " +
      "({environment, ambientSounds string[], soundEffects string[]}), action " +
      "({type: narrate|exercise|choice|complete, exerciseId?, reps?, durationSeconds?, prompt}), " +
      "responseExpectation (one of none, user_speech, exercise_completion), " +
      "stateChanges ({xp integer >= 0, healthDelta integer}). " +
      "This turn must advance the story with new events and must not repeat or paraphrase any previous narration.",
  ].join("\n");
}
