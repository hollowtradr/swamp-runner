/**
 * src/chunks/types.ts — Pattern chunk types for Sticker Galaxy esport core.
 *
 * Phase 2: defines the shared chunk format used by ChunkPicker and all
 * per-game chunk libraries. All minigames that adopt the esport stack
 * share this format.
 */

/** The lane a player can occupy. 'ground' = running on the ground,
 *  'air-low' = low jump height, 'air-high' = double-jump apex,
 *  'platform' = standing on a log/platform. */
export type Lane = 'ground' | 'air-low' | 'air-high' | 'platform'

/** The set of lanes the player can occupy at a chunk boundary. */
export interface LaneState {
  lanes: Lane[]
}

/** Entity types understood by the swamp-runner spawner. */
export type EntityType =
  | 'slime'
  | 'mynock'
  | 'vine'
  | 'log'
  | 'sinking_log'
  | 'essence'
  | 'holocron'
  | 'bibo'

/** One entity within a chunk. */
export interface ChunkEntity {
  /** Milliseconds after chunk start when this entity appears at spawn X. */
  offset_ms: number
  type: EntityType
  lane: Lane
  /** Optional per-entity overrides (e.g. { width: 50 } for wide slimes). */
  params?: Record<string, number | string | boolean>
}

/** A hand-authored pattern chunk. */
export interface Chunk {
  id: string
  game: string
  /** 1–10 hand-rated difficulty. */
  difficulty: number
  /** Playthrough length in milliseconds. */
  duration_ms: number
  /** Semantic tags (e.g. 'jump', 'dive', 'platform'). */
  tags: string[]
  /** Which lane(s) the player must arrive in for this chunk to feel intended. */
  entry: LaneState
  /** Which lane(s) the player may safely be in when this chunk ends. */
  exit: LaneState
  entities: ChunkEntity[]
}

/**
 * A bridge chunk is a short gap-filler inserted by ChunkPicker when no
 * library chunk satisfies the entry/exit contract between two chunks.
 * Additional `from`/`to` fields express the lane shift it covers.
 */
export interface BridgeChunk extends Chunk {
  from: Lane[]
  to: Lane[]
}
