/**
 * sticker-galaxy-sdk-core — Sticker Galaxy esport primitives
 *
 * Phase 1: determinism + replay primitives + ghost run support.
 *
 * Usage (in any Sticker Galaxy minigame):
 *   import { SeededRNG, FixedStepAccumulator, TICK_DT,
 *            createReplay, Mode, dailySeedForToday, GhostTrack } from 'sticker-galaxy-sdk-core';
 */

// PRNG
export { SeededRNG } from './prng.js'

// Fixed-step physics driver
export { FixedStepAccumulator, TICK_MS, TICK_DT } from './fixed-step.js'

// Replay primitives
export {
  createReplay,
  recordInput,
  recordGhostSample,
  serialize,
  deserialize,
  verify,
  type Replay,
  type InputEvent,
  type GhostSample,
} from './replay.js'

// Game modes + seed derivation
export {
  type Mode,
  deriveDailySeed,
  dailySeedForToday,
} from './modes.js'

// Ghost track
export { GhostTrack, type GhostPoint } from './ghost.js'

// Phase 2: pattern chunks
export type {
  Lane,
  LaneState,
  EntityType,
  ChunkEntity,
  Chunk,
  BridgeChunk,
} from './chunks/types.js'
export type { CurvePoint, Curve } from './chunks/curves.js'
export {
  CASUAL_CURVE,
  DAILY_CURVE,
  TOURNEY_CURVE,
  sampleCurve,
  difficultyAt,
} from './chunks/curves.js'
export { BRIDGE_CHUNKS } from './chunks/bridge.js'
export { ChunkPicker, lanesIntersect } from './chunks/picker.js'
