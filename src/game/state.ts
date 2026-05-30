/**
 * src/game/state.ts — Swamp Runner game state
 *
 * All mutable game state lives here. No framework, no reactivity.
 * Physics and spawn logic mutate this object directly each frame.
 */

import { SeededRNG, type Mode, type InputEvent, type GhostSample, GhostTrack, ChunkPicker, type LaneState, type Chunk } from 'sticker-galaxy-sdk-core'
export { SeededRNG, GhostTrack }
export type { Mode, InputEvent, GhostSample }

// ── Entity types ─────────────────────────────────────────────────────────────

export type PlayerAnim = 'running' | 'jumping' | 'hit' | 'dead'

export interface Player {
  x: number            // fixed screen X
  screenY: number      // top-left Y on screen (= groundY - height)
  vy: number           // vertical velocity (px/s, negative = up)
  width: number
  height: number
  grounded: boolean
  onPlatformId: number | null
  jumpHoldMs: number   // ms pointer has been held (capped at MAX_JUMP_HOLD)
  isHoldingJump: boolean
  doubleJumpAvailable: boolean  // true after first jump; set false after double-jump
  anim: PlayerAnim
  hitFlashTimer: number  // seconds of hit flash remaining
  shieldActive: boolean
  shieldTimer: number    // seconds remaining on shield
  coyoteTimer: number    // seconds of coyote grace remaining after walking off edge (0.1s max)
  jumpBufferTimer: number  // seconds of jump pre-buffer (0.15s max); auto-fires jump on landing
}

export type ObstacleType = 'slime' | 'mynock' | 'vine' | 'vine_shadow'

export interface Obstacle {
  id: number
  x: number           // left edge in world-scroll coords (decrements each frame)
  y: number           // top edge screen Y
  width: number
  height: number
  type: ObstacleType
  pairId: number      // vine_shadow <-> vine share same pairId
  dropCountdown: number  // seconds until vine drops (for vine_shadow)
  dropped: boolean    // has vine started falling?
  vy: number          // falling vine speed
}

export type PickupType = 'essence' | 'holocron' | 'bibo'

export interface Pickup {
  id: number
  x: number
  y: number
  type: PickupType
  collected: boolean
  glowPhase: number   // 0..2π, cycles for glow animation
}

export type PlatformType = 'log' | 'sinking_log'

export interface Platform {
  id: number
  x: number           // left edge world-scroll coords
  y: number           // TOP of platform screen Y (player feet rest here)
  width: number
  height: number      // visual thickness
  type: PlatformType
  sinkTimer: number   // time player has stood on it (sinking_log only)
  sinking: boolean    // has sinking started?
  sinkOffset: number  // current pixel drop amount
}

export interface Banner {
  text: string
  timer: number    // seconds remaining
  maxTime: number
}

// ── Main state ────────────────────────────────────────────────────────────────

export interface GameState {
  phase: 'idle' | 'title' | 'playing' | 'ended'
  player: Player
  platforms: Platform[]
  obstacles: Obstacle[]
  pickups: Pickup[]

  groundY: number         // screen Y where ground is (player feet baseline)
  worldOffset: number     // total pixels world has scrolled

  distance: number        // Force-paces traveled (integer, floor of worldOffset/PACE_SCALE)
  score: number           // distance + pickup bonuses
  gameTime: number        // seconds since play started

  scrollSpeed: number     // px/s world scroll speed
  speedBoostTimer: number // seconds remaining on Holocron speed boost
  speedBoostActive: boolean

  screenFlashTimer: number  // seconds of white/blue screen flash

  banner: Banner | null
  milestones: Set<number>   // which score milestones have fired

  pickupsCollected: number
  /** Accumulated bonus score from pickups. Added to distance to get final
   *  score so that pickup rewards aren't wiped by the per-frame
   *  `score = distance` recompute. */
  pickupBonus: number
  maxSpeedReached: number
  longestCombo: number
  currentCombo: number

  spawnTimer: number      // time since last obstacle/pickup spawn attempt
  idCounter: number       // monotonic ID for new entities

  // ── Esport / determinism (Phase 1) ─────────────────────────────────────────
  /** Seed used to initialize the RNG for this run. */
  seed: number
  /** Run mode. */
  mode: Mode
  /** Seeded PRNG — all spawn randomness goes through this. */
  rng: SeededRNG
  /** Physics tick counter. Incremented once per fixed step (1/60s). */
  tick: number
  /** Inputs recorded this run for the replay log. */
  replayInputs: InputEvent[]
  /** Ghost track samples recorded this run (every 6 ticks). */
  ghostSamples: GhostSample[]
  /** PB ghost track loaded from localStorage (null if none). */
  pbGhostTrack: GhostTrack | null
  /** Whether to render the ghost overlay. */
  showGhost: boolean

  // ── Phase 2: chunk picker ────────────────────────────────────────────────────
  /**
   * 'chunks' = authored chunk stream (default).
   * 'iid'    = legacy independent per-tick probability spawner (?legacy=1).
   * Daily mode always forces 'chunks' regardless of URL param.
   */
  spawnMode: 'chunks' | 'iid'
  /**
   * Deterministic chunk picker. Null when spawnMode === 'iid'.
   * Initialized in createInitialState() when spawnMode === 'chunks'.
   */
  chunkPicker: ChunkPicker | null
  /**
   * Screen X of the right edge of the last queued chunk.
   * Decrements by scrollSpeed*dt each tick (same as obstacle x).
   * When it falls below canvasW + 80, maybeSpawn() enqueues more chunks.
   */
  chunkQueueScreenX: number
  /**
   * The exit LaneState of the most recently queued chunk.
   * ChunkPicker uses it to enforce entry contracts on the next chunk.
   */
  lastChunkExit: LaneState
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const GRAVITY = 1400          // px/s²
export const JUMP_POWER_MIN = 480    // px/s upward velocity for tap
export const JUMP_POWER_MAX = 820    // px/s for max hold
export const MAX_JUMP_HOLD_MS = 450  // ms to reach max power
export const PACE_SCALE = 3          // world pixels per Force-pace

export const BASE_SCROLL_SPEED = 200
export const MAX_SCROLL_SPEED = 520
export const SPEED_BOOST_FACTOR = 1.5
export const SPEED_BOOST_DURATION = 2.0

export const PLAYER_WIDTH = 52
export const PLAYER_HEIGHT = 64

// Physics guardrail constants
export const COYOTE_TIME_SECS = 0.10   // grace window after walking off edge
export const JUMP_BUFFER_SECS = 0.15   // pre-buffer window: jump input registered before landing
export const PLAYER_HITBOX_RADIUS_INSET = 4  // circular hitbox inset from PLAYER_WIDTH/2

export const SCORE_MILESTONES = [100, 500, 1000]

export const YODA_QUOTES: Record<number, string> = {
  100:  'Strong with the Force, you are.',
  500:  'Hmm. Surprised, I am.',
  1000: 'A Jedi craves not these things, but impressive this is.',
}

export const GAME_OVER_QUOTES = [
  'Do or do not. There is no try.',
  'Failed today, you have. Tomorrow, try again.',
]

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh GameState for a new run.
 * @param seed    Seed for the run's PRNG (casual: crypto random, daily: derived).
 * @param mode    Run mode.
 * @param chunks  Chunk library (pass SWAMP_RUNNER_CHUNKS). When omitted or empty,
 *                falls back to legacy IID spawner.
 */
export function createInitialState(
  canvasW: number,
  canvasH: number,
  seed = 0,
  mode: Mode = 'casual',
  chunks: Chunk[] = [],
): GameState {
  const groundY = Math.round(canvasH * 0.74)
  const playerX = Math.round(canvasW * 0.18)

  return {
    phase: 'idle',
    player: {
      x: playerX,
      screenY: groundY - PLAYER_HEIGHT,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      grounded: true,
      onPlatformId: null,
      jumpHoldMs: 0,
      isHoldingJump: false,
      doubleJumpAvailable: false,
      anim: 'running',
      hitFlashTimer: 0,
      shieldActive: false,
      shieldTimer: 0,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
    },
    platforms: [],
    obstacles: [],
    pickups: [],
    groundY,
    worldOffset: 0,
    distance: 0,
    score: 0,
    gameTime: 0,
    scrollSpeed: BASE_SCROLL_SPEED,
    speedBoostTimer: 0,
    speedBoostActive: false,
    screenFlashTimer: 0,
    banner: null,
    milestones: new Set(),
    pickupsCollected: 0,
    pickupBonus: 0,
    maxSpeedReached: BASE_SCROLL_SPEED,
    longestCombo: 0,
    currentCombo: 0,
    spawnTimer: 0,
    idCounter: 1,

    // Esport fields (Phase 1)
    seed,
    mode,
    rng: new SeededRNG(seed),
    tick: 0,
    replayInputs: [],
    ghostSamples: [],
    pbGhostTrack: null,
    showGhost: true,

    // Phase 2: chunk picker
    // Daily mode always uses chunks; casual uses chunks if library provided;
    // ?legacy=1 URL param forces IID path (see game/index.ts).
    spawnMode: (chunks.length > 0 || mode === 'daily') ? 'chunks' : 'iid',
    chunkPicker: chunks.length > 0
      ? new ChunkPicker(chunks, new SeededRNG(seed))
      : null,
    // Queue starts just off the right edge of the viewport.
    // canvasW is passed in but not available here — phaser-scene will
    // prime the queue via the first maybeSpawn() call in physics, which
    // receives canvasW. We start at 0 so the first tick immediately fills.
    chunkQueueScreenX: 0,
    lastChunkExit: { lanes: ['ground'] },
  }
}

export function nextId(state: GameState): number {
  return state.idCounter++
}

/**
 * Apply a revive to a game-over state. Preserves score, distance, midi,
 * gameTime, and world scroll position. Resets only the player (back to
 * running) and clears a safety window of obstacles/pickups so the player
 * doesn't die on the very next frame.
 *
 * Caller is responsible for putting state.phase back to 'playing' AFTER
 * any scene-level guards (e.g. gameEndFired) have been cleared.
 */
export function applyRevive(state: GameState): void {
  // Reset player to a fresh running state at its standard X.
  state.player.vy = 0
  state.player.grounded = true
  state.player.onPlatformId = null
  state.player.jumpHoldMs = 0
  state.player.isHoldingJump = false
  state.player.doubleJumpAvailable = false
  state.player.anim = 'running'
  state.player.hitFlashTimer = 0
  state.player.coyoteTimer = 0
  state.player.jumpBufferTimer = 0
  // Snap to ground baseline -- avoids falling through if player died airborne.
  state.player.screenY = state.groundY - state.player.height

  // Short invulnerability shield so the player has time to react.
  state.player.shieldActive = true
  state.player.shieldTimer = 2.0  // seconds

  // Clear a safety window: any obstacle / pickup ahead of the player within
  // ~one viewport width gets removed so the revive doesn't drop them right
  // back into the same hazard pattern that killed them.
  const safetyMargin = 600  // px ahead
  state.obstacles = state.obstacles.filter((o) => o.x > state.player.x + safetyMargin)
  // Keep pickups -- a clean board feels rewarding -- but remove anything
  // *inside* the safety bubble so the player doesn't auto-vacuum collect.
  state.pickups = state.pickups.filter(
    (p) => p.x < state.player.x - 50 || p.x > state.player.x + safetyMargin,
  )

  // Reset spawn timer (legacy IID path) and chunk queue (Phase 2 path).
  state.spawnTimer = 0
  // Chunk queue: reset to 0 so the first post-revive maybeSpawn() refills
  // the queue cleanly from the current chunk picker state. Also reset the
  // recent-window so the player doesn't see the same pre-death pattern.
  state.chunkQueueScreenX = 0
  state.lastChunkExit = { lanes: ['ground'] }
  state.chunkPicker?.reset()
  // Flash the screen so the revive is visually obvious.
  state.screenFlashTimer = 0.3
}
