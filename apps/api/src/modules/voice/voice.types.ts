export interface TextToSpeechService {
  synthesize(text: string): Promise<Buffer>;
}

export interface SoundEffectsService {
  /** Generate (or serve cached) one-shot SFX for an allowlisted ID. */
  generateSfx(id: string): Promise<Buffer>;
}

export interface MusicService {
  /** Generate (or serve cached) looping environment bed music. */
  generateEnvironmentMusic(environment: string): Promise<Buffer>;
}
