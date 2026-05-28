/**
 * src/game/state.ts — Swamp Runner game state
 *
 * All mutable game state lives here. No framework, no reactivity.
 * Physics and spawn logic mutate this object directly each frame.
 */

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
  maxSpeedReached: number
  longestCombo: number
  currentCombo: number

  spawnTimer: number      // time since last obstacle/pickup spawn attempt
  idCounter: number       // monotonic ID for new entities
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

export function createInitialState(canvasW: number, canvasH: number): GameState {
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
    maxSpeedReached: BASE_SCROLL_SPEED,
    longestCombo: 0,
    currentCombo: 0,
    spawnTimer: 0,
    idCounter: 1,
  }
}

export function nextId(state: GameState): number {
  return state.idCounter++
}
