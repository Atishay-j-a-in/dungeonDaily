import { describe, expect, it } from "vitest";
import { DungeonMasterOutputSchema } from "@dungeonsdaily/shared";
import { DungeonMasterService } from "../src/modules/ai/dm-service.js";
import {
  FakeDungeonMaster,
  deterministicFallback,
} from "../src/modules/ai/fake-dm.js";
import {
  GemmaService,
  extractJsonFromText,
  normalizeDmJson,
} from "../src/modules/ai/gemma.service.js";
import { exerciseCatalogForPrompt } from "../src/modules/game/game-engine.js";

function baseInput() {
  return {
    sessionId: "s1",
    durationMinutes: 10 as const,
    elapsedSeconds: 0,
    scene: "dungeon",
    chapter: 1,
    turnNumber: 1,
    player: { level: 1, xp: 0, health: 100 },
    completedExercises: [],
    recentTurns: [],
    exerciseCatalog: exerciseCatalogForPrompt(),
  };
}

describe("AI validation", () => {
  it("accepts valid Gemma output", () => {
    const parsed = DungeonMasterOutputSchema.safeParse({
      narration: "You push deeper into the forest.",
      mood: "danger",
      scene: {
        environment: "forest",
        ambientSounds: ["wind"],
        soundEffects: ["wolf_growl"],
      },
      action: {
        type: "exercise",
        exerciseId: "squats",
        reps: 10,
        prompt: "Defeat the wolf with ten powerful squats.",
      },
      responseExpectation: "exercise_completion",
      stateChanges: { xp: 20, healthDelta: 0 },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed output", () => {
    expect(
      DungeonMasterOutputSchema.safeParse({ narration: 42 }).success,
    ).toBe(false);
    expect(
      DungeonMasterOutputSchema.safeParse({
        narration: "x".repeat(600),
        mood: "danger",
        scene: { environment: "forest", ambientSounds: [], soundEffects: [] },
        action: { type: "narrate", prompt: "hi" },
        responseExpectation: "none",
        stateChanges: { xp: 0, healthDelta: 0 },
      }).success,
    ).toBe(false);
  });

  it("fake DM always produces valid output", async () => {
    const svc = new DungeonMasterService(new FakeDungeonMaster());
    const { output, degraded } = await svc.generateValidatedTurn(baseInput());
    expect(DungeonMasterOutputSchema.safeParse(output).success).toBe(true);
    expect(degraded).toBe(false);
  });

  it("falls back when the model throws", async () => {
    const broken = {
      generateTurn: async () => {
        throw new Error("boom");
      },
    };
    const svc = new DungeonMasterService(broken);
    const { output, degraded, reason } = await svc.generateValidatedTurn(baseInput());
    expect(output.narration).toBe(deterministicFallback().narration);
    expect(degraded).toBe(true);
    expect(reason).toContain("boom");
  });

  it("falls back when the model returns garbage twice", async () => {
    const garbage = {
      generateTurn: async () => ({ nonsense: true }) as never,
    };
    const svc = new DungeonMasterService(garbage);
    const { output, degraded } = await svc.generateValidatedTurn(baseInput());
    expect(DungeonMasterOutputSchema.safeParse(output).success).toBe(true);
    expect(degraded).toBe(true);
  });

  it("accepts explicit nulls the way Gemma emits them", () => {
    const parsed = DungeonMasterOutputSchema.safeParse({
      narration: "Brace yourself.",
      mood: "tense",
      scene: {
        environment: "dungeon",
        music: null,
        ambientSounds: ["fire"],
        soundEffects: null,
      },
      action: {
        type: "exercise",
        exerciseId: "squats",
        reps: 10,
        durationSeconds: null,
        prompt: "Ten squats!",
      },
      responseExpectation: "exercise_completion",
      stateChanges: { xp: null, healthDelta: null },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.action.durationSeconds).toBeUndefined();
      expect(parsed.data.scene.soundEffects).toEqual([]);
      expect(parsed.data.stateChanges.xp).toBe(0);
    }
  });

  it("salvages JSON from prose-wrapped model output", () => {
    const raw =
      'Here is your turn:\n```json\n{"narration": "hi"}\n```\nEnjoy!';
    expect(extractJsonFromText(raw)).toBe('{"narration": "hi"}');
    expect(extractJsonFromText("no json here at all")).toBeNull();
  });

  it("normalizes near-miss model vocabulary (observed live failure)", () => {
    const normalized = normalizeDmJson({
      narration: "The crypt looms. Ten squats!",
      mood: "mystery",
      scene: {
        environment: "crypt",
        ambientSounds: ["dungeon"],
        soundEffects: ["sword_hit"],
      },
      action: {
        type: "combat",
        exerciseId: "squats",
        reps: "10",
        prompt: "Ten squats!",
      },
      responseExpectation: "player_action",
      stateChanges: { xp: "20", healthDelta: 0 },
    });
    const parsed = DungeonMasterOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mood).toBe("mysterious");
      expect(parsed.data.scene.environment).toBe("dungeon");
      expect(parsed.data.action.type).toBe("exercise");
      expect(parsed.data.action.reps).toBe(10);
      expect(parsed.data.responseExpectation).toBe("user_speech");
      expect(parsed.data.stateChanges.xp).toBe(20);
    }
  });

  it("GemmaService refuses clearly without a Google API key", async () => {
    // tests/setup.ts clears GOOGLE_GENERATIVE_AI_API_KEY, so the provider
    // must fail fast with an actionable message instead of calling Google.
    const svc = new GemmaService();
    await expect(svc.generateTurn(baseInput())).rejects.toThrow(
      /GOOGLE_GENERATIVE_AI_API_KEY/,
    );
  });

  it("story advances every turn — no repeated template", async () => {
    const svc = new DungeonMasterService(new FakeDungeonMaster());
    const narrations: string[] = [];
    for (let turn = 0; turn < 6; turn += 1) {
      const { output } = await svc.generateValidatedTurn({
        ...baseInput(),
        turnNumber: turn,
        recentTurns:
          turn === 0 ? [] : [{ speaker: "user", text: "I press on!" }],
      });
      narrations.push(output.narration);
    }
    expect(new Set(narrations).size).toBe(narrations.length);
  });

  it("acknowledges completed exercises", async () => {
    const svc = new DungeonMasterService(new FakeDungeonMaster());
    const { output } = await svc.generateValidatedTurn({
      ...baseInput(),
      completedExercises: ["squats"],
      recentTurns: [{ speaker: "user", text: "I have done the squats" }],
    });
    expect(output.narration).toMatch(/well done/i);
  });

  it("different player responses all produce valid DM responses", async () => {    const svc = new DungeonMasterService(new FakeDungeonMaster());
    for (const text of [
      "I attack the goblin!",
      "done",
      "I run deeper into the cave, torch held high",
    ]) {
      const { output, degraded } = await svc.generateValidatedTurn({
        ...baseInput(),
        recentTurns: [{ speaker: "user", text }],
      });
      expect(DungeonMasterOutputSchema.safeParse(output).success).toBe(true);
      expect(degraded).toBe(false);
    }
  });
});
