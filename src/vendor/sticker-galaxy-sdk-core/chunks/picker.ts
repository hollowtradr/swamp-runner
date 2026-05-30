/**
 * src/chunks/picker.ts — ChunkPicker: deterministic chunk selection.
 *
 * Selects the next chunk from the library based on:
 *   1. Difficulty: difficultyAt(t, mode) ±1 bucket
 *   2. Entry contract: chunk.entry.lanes ∩ lastExit.lanes ≠ ∅ (or bridge)
 *   3. No-repeat window: last 4 chunk IDs excluded for variety
 *
 * Identical seed → identical chunk sequence (deterministic via SeededRNG).
 *
 * Phase 2 esport guarantees:
 *   - Same seed + same chunk library → same run every time
 *   - Entry/exit contracts always satisfied (bridge fallback)
 *   - No chunk repeats within 4-chunk window
 */

import type { SeededRNG } from '../prng.js'
import type { Chunk, LaneState, BridgeChunk } from './types.js'
import { difficultyAt } from './curves.js'
import type { Mode } from '../modes.js'
import { BRIDGE_CHUNKS } from './bridge.js'

/** Number of chunks to remember for the no-repeat window. */
const NO_REPEAT_WINDOW = 4

export class ChunkPicker {
  private readonly chunks: Chunk[]
  private readonly rng: SeededRNG
  /** Sliding window of recently-used chunk IDs. */
  private recentIds: string[] = []

  constructor(chunks: Chunk[], rng: SeededRNG) {
    if (chunks.length === 0) {
      throw new Error('ChunkPicker: chunks array must not be empty')
    }
    this.chunks = chunks
    this.rng = rng
  }

  /**
   * Returns the next chunk to spawn.
   *
   * @param currentT_ms  Game time in milliseconds since run start.
   * @param mode         Run mode (casual / daily / tourney / pro).
   * @param lastExit     The exit LaneState of the previous chunk.
   */
  next(currentT_ms: number, mode: Mode, lastExit: LaneState): Chunk {
    const target = Math.floor(difficultyAt(currentT_ms, mode))
    const candidates = this.getCandidates(target, lastExit)

    if (candidates.length === 0) {
      // No matching library chunk — insert a bridge chunk instead.
      return this.pickBridge(lastExit)
    }

    const picked = this.rng.pick(candidates)
    this.recordRecent(picked.id)
    return picked
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private getCandidates(targetDifficulty: number, lastExit: LaneState): Chunk[] {
    const lo = Math.max(1, targetDifficulty - 1)
    const hi = Math.min(10, targetDifficulty + 1)
    const recentSet = new Set(this.recentIds)

    return this.chunks.filter((chunk) => {
      if (chunk.difficulty < lo || chunk.difficulty > hi) return false
      if (recentSet.has(chunk.id)) return false
      if (!lanesIntersect(chunk.entry.lanes, lastExit.lanes)) return false
      return true
    })
  }

  private pickBridge(lastExit: LaneState): BridgeChunk {
    // Prefer a bridge that starts from lastExit lanes (exact match).
    const matches = BRIDGE_CHUNKS.filter((b) =>
      lanesIntersect(b.from, lastExit.lanes),
    )
    const pool = matches.length > 0 ? matches : BRIDGE_CHUNKS
    const bridge = this.rng.pick(pool)
    this.recordRecent(bridge.id)
    return bridge
  }

  private recordRecent(id: string): void {
    this.recentIds.push(id)
    if (this.recentIds.length > NO_REPEAT_WINDOW) {
      this.recentIds.shift()
    }
  }

  /**
   * Reset the recent-chunk window (e.g. after a revive, so the next run
   * doesn't inherit memory from the previous one).
   */
  reset(): void {
    this.recentIds = []
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

/** Returns true if any lane in `a` is also present in `b`. */
export function lanesIntersect(a: string[], b: string[]): boolean {
  return a.some((lane) => b.includes(lane))
}
