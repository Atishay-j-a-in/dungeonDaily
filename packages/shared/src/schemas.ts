import { z } from "zod";

// ---------------------------------------------------------------------------
// Session primitives (guide §6)
// ---------------------------------------------------------------------------

export const SessionDurationSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
]);
export type SessionDuration = z.infer<typeof SessionDurationSchema>;

export const SessionStatusSchema = z.enum([
  "created",
  "active",
  "paused",
  "completed",
  "abandoned",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// ---------------------------------------------------------------------------
// Exercises (guide §7)
// ---------------------------------------------------------------------------

export const ExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["strength", "cardio", "core", "mobility"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  defaultReps: z.number().int().positive().optional(),
  defaultDurationSeconds: z.number().int().positive().optional(),
  equipment: z.literal("none"),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

// ---------------------------------------------------------------------------
// Dungeon Master structured output (guide §4)
// ---------------------------------------------------------------------------

export const DungeonMasterOutputSchema = z.object({
  narration: z.string().min(1).max(500),
  mood: z.enum([
    "calm",
    "mysterious",
    "tense",
    "combat",
    "victorious",
    "danger",
  ]),
  scene: z.object({
    environment: z.enum([
      "forest",
      "cave",
      "dungeon",
      "castle",
      "village",
      "battlefield",
      "mountain",
      "ruins",
    ]),
    music: z.string().nullish().transform((v) => v ?? undefined),
    ambientSounds: z
      .array(z.string())
      .max(5)
      .nullish()
      .transform((v) => v ?? []),
    soundEffects: z
      .array(z.string())
      .max(5)
      .nullish()
      .transform((v) => v ?? []),
  }),
  action: z.object({
    type: z.enum(["narrate", "exercise", "choice", "complete"]),
    exerciseId: z.string().nullish().transform((v) => v ?? undefined),
    reps: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? undefined),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? undefined),
    prompt: z.string().max(200),
  }),
  responseExpectation: z.enum([
    "none",
    "user_speech",
    "exercise_completion",
  ]),
  stateChanges: z.object({
    xp: z
      .number()
      .int()
      .min(0)
      .nullish()
      .transform((v) => v ?? 0),
    healthDelta: z
      .number()
      .int()
      .nullish()
      .transform((v) => v ?? 0),
  }),
});
export type DungeonMasterOutput = z.infer<typeof DungeonMasterOutputSchema>;

export const DungeonMasterTurnSchema = z.object({
  speaker: z.enum(["dm", "user"]),
  text: z.string(),
});
export type DungeonMasterTurn = z.infer<typeof DungeonMasterTurnSchema>;

export const DungeonMasterInputSchema = z.object({
  sessionId: z.string(),
  durationMinutes: SessionDurationSchema,
  elapsedSeconds: z.number().int().min(0),
  scene: z.string(),
  chapter: z.number().int().min(1),
  turnNumber: z.number().int().min(0),
  player: z.object({
    level: z.number().int().min(1),
    xp: z.number().int().min(0),
    health: z.number().int(),
  }),
  currentExercise: z
    .object({
      exerciseId: z.string(),
      reps: z.number().int().positive().optional(),
      durationSeconds: z.number().int().positive().optional(),
      completed: z.boolean(),
    })
    .optional(),
  completedExercises: z.array(z.string()),
  recentTurns: z.array(DungeonMasterTurnSchema).max(8),
  exerciseCatalog: z.array(ExerciseSchema),
});
export type DungeonMasterInput = z.infer<typeof DungeonMasterInputSchema>;

// ---------------------------------------------------------------------------
// Audio environment (guide §14)
// ---------------------------------------------------------------------------

export const AudioEnvironmentSchema = z.enum([
  "forest",
  "cave",
  "dungeon",
  "castle",
  "village",
  "battlefield",
  "mountain",
  "ruins",
]);
export type AudioEnvironment = z.infer<typeof AudioEnvironmentSchema>;

// ---------------------------------------------------------------------------
// API DTOs (guide §11, §13)
// ---------------------------------------------------------------------------

export const CreateSessionRequestSchema = z.object({
  userId: z.string().min(1),
  durationMinutes: SessionDurationSchema,
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SessionResponseRequestSchema = z
  .object({
    text: z.string().min(1).max(2000).optional(),
    // Alias: voice clients may send `{ message }`; typed clients send `{ text }`.
    // Both travel through the identical backend pipeline.
    message: z.string().min(1).max(2000).optional(),
  })
  .refine((v) => (v.text?.trim() ?? "") !== "" || (v.message?.trim() ?? "") !== "", {
    message: "Either 'text' or 'message' is required",
  });
export type SessionResponseRequest = z.infer<typeof SessionResponseRequestSchema>;

export const CompleteExerciseRequestSchema = z.object({
  exerciseId: z.string().min(1),
});
export type CompleteExerciseRequest = z.infer<typeof CompleteExerciseRequestSchema>;

export const SynthesizeRequestSchema = z.object({
  // Full DM turns (narration + exercise prompt) routinely exceed 1000.
  text: z.string().min(1).max(4000),
});
export type SynthesizeRequest = z.infer<typeof SynthesizeRequestSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
