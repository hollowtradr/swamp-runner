/**
 * src/game/spawn.ts — Phase 2 chunk-based spawner.
 *
 * Replaces the Phase 1 IID (independent per-tick probability) spawner.
 * Drives all obstacle/pickup/platform creation from a deterministic
 * ChunkPicker stream instead of independent probability rolls.
 *
 * Key guarantees:
 *   - Same seed + same chunk library → same run every time (via SeededRNG)
 *   - Entry/exit contracts always satisfied (bridge chunks fill gaps)
 *   - No chunk repeats within 4-chunk window (variety guarantee)
 *   - Always-solvable: every chunk passes solo-solvability authoring check
 *
 * Legacy IID path is in spawn-legacy.ts behind the ?legacy=1 URL param.
 * GameState.spawnMode controls which path is active.
 */

import type { Chunk } from 'sticker-galaxy-sdk-core'
import {
  type GameState,
  type Obstacle,
  type Pickup,
  type Platform,
  nextId,
} from './state.js'

// ── Spatial conversion ────────────────────────────────────────────────────────

/**
 * Pixels per millisecond used to convert chunk duration / entity offset_ms
 * into screen-space pixel distances.
 *
 * Chosen as 0.25 px/ms (250 px/s), which lies between BASE_SCROLL_SPEED (200)
 * and mid-game speed. Playback fidelity is accurate at ~250 px/s and degrades
 * gracefully at higher/lower speeds (acceptable for Phase 2 per spec).
 */
export const SCROLL_PX_PER_MS = 0.25

// ── Lane → screen Y ───────────────────────────────────────────────────────────

function laneToY(lane: string, groundY: number, entityType: string): number {
  switch (lane) {
    case 'ground':
      // Slimes sit on the floor; bibo swims just below ground level
      return entityType === 'bibo' ? groundY - 20 : groundY - 18
    case 'air-low':
      // Mynocks + essence at low jump height (~90px above ground)
      return groundY - 90
    case 'air-high':
      // Holocrons + essence at double-jump apex (~155px above ground)
      return groundY - 155
    case 'platform':
      // Log tops float 40-55px above the ground line
      return groundY - 55
    default:
      return groundY - 40
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Called each fixed-step tick from physics.ts.
 *
 * Keeps the chunk queue filled: while the right edge of the queued chunk
 * stream is within view + 80px buffer, pop the next chunk from ChunkPicker
 * and lay its entities at the current queue X.
 *
 * `state.chunkQueueScreenX` is advanced forward by each chunk's pixel span.
 * Physics decrements chunkQueueScreenX by (scroll * dt) each tick, so the
 * window naturally slides leftward with the world.
 */
export function maybeSpawn(state: GameState, canvasW: number): void {
  if (state.spawnMode !== 'chunks') return
  if (!state.chunkPicker) return

  // Keep ~1 screen width of chunks pre-queued ahead of the viewport.
  while (state.chunkQueueScreenX < canvasW + 80) {
    const chunk = state.chunkPicker.next(
      state.gameTime * 1000,   // gameTime is in seconds; picker expects ms
      state.mode,
      state.lastChunkExit,
    )
    lay(state, chunk, state.chunkQueueScreenX)
    state.chunkQueueScreenX += chunk.duration_ms * SCROLL_PX_PER_MS
    state.lastChunkExit = chunk.exit
  }
}

// ── Chunk → entities ─────────────────────────────────────────────────────────

/**
 * Translate a Chunk's entities into actual Obstacle / Pickup / Platform
 * records at position `startX` on screen.
 */
function lay(state: GameState, chunk: Chunk, startX: number): void {
  for (const entity of chunk.entities) {
    const x = startX + entity.offset_ms * SCROLL_PX_PER_MS
    const y = laneToY(entity.lane, state.groundY, entity.type)
    const p = entity.params ?? {}

    switch (entity.type) {
      case 'slime':
        laySlime(state, x, y, p)
        break
      case 'mynock':
        layMynock(state, x, y)
        break
      case 'vine':
        layVine(state, x, y)
        break
      case 'log':
        layLog(state, x, y, false, p)
        break
      case 'sinking_log':
        layLog(state, x, y, true, p)
        break
      case 'essence':
      case 'holocron':
      case 'bibo':
        layPickup(state, x, y, entity.type)
        break
    }
  }
}

// ── Entity factories ──────────────────────────────────────────────────────────

function laySlime(
  state: GameState,
  x: number,
  y: number,
  params: Record<string, number | string | boolean>,
): void {
  // Params can override width; default to a fixed size (not random) so
  // determinism is maintained. Small slime = 32px, default = 42px.
  const w = typeof params.width === 'number' ? params.width : 42
  const ob: Obstacle = {
    id: nextId(state),
    x,
    y,
    width: w,
    height: 18,
    type: 'slime',
    pairId: 0,
    dropCountdown: 0,
    dropped: false,
    vy: 0,
  }
  state.obstacles.push(ob)
}

function layMynock(state: GameState, x: number, y: number): void {
  // Fixed height band — avoids random wobble in placement (wobble is render-
  // only and driven by gameTime, not spawn-time). Y is set by laneToY.
  const ob: Obstacle = {
    id: nextId(state),
    x,
    y,
    width: 64,
    height: 28,
    type: 'mynock',
    pairId: 0,
    dropCountdown: 0,
    dropped: false,
    vy: 0,
  }
  state.obstacles.push(ob)
}

function layVine(state: GameState, x: number, _y: number): void {
  // Vine always drops from the top. The shadow sits at groundY;
  // the vine itself starts above screen.
  const pairId = nextId(state)
  const vineH = 80  // fixed height for authored chunks (no randomness)

  const shadow: Obstacle = {
    id: nextId(state),
    x: x - 15,
    y: state.groundY - 6,
    width: 30,
    height: 10,
    type: 'vine_shadow',
    pairId,
    dropCountdown: 1.0,
    dropped: false,
    vy: 0,
  }
  const vine: Obstacle = {
    id: nextId(state),
    x: x - 10,
    y: -vineH,
    width: 20,
    height: vineH,
    type: 'vine',
    pairId,
    dropCountdown: 1.0,
    dropped: false,
    vy: 0,
  }
  state.obstacles.push(shadow, vine)
}

function layLog(
  state: GameState,
  x: number,
  y: number,
  sinking: boolean,
  params: Record<string, number | string | boolean>,
): void {
  const w = typeof params.width === 'number' ? params.width : 100
  // y is the log TOP surface (laneToY returns platform lane Y)
  const pl: Platform = {
    id: nextId(state),
    x,
    y,
    width: w,
    height: 16,
    type: sinking ? 'sinking_log' : 'log',
    sinkTimer: 0,
    sinking: false,
    sinkOffset: 0,
  }
  state.platforms.push(pl)
}

function layPickup(
  state: GameState,
  x: number,
  y: number,
  type: 'essence' | 'holocron' | 'bibo',
): void {
  // Use state.rng only for the glow phase (visual only, doesn't affect gameplay).
  const pk: Pickup = {
    id: nextId(state),
    x,
    y,
    type,
    collected: false,
    glowPhase: state.rng.next() * Math.PI * 2,
  }
  state.pickups.push(pk)
}
