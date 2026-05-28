/**
 * src/game/spawn.ts — Obstacle, pickup, and platform spawner
 *
 * Called each frame when spawnTimer exceeds a threshold.
 * Difficulty scales with gameTime.
 */

import {
  type GameState,
  type Obstacle,
  type ObstacleType,
  type Pickup,
  type Platform,
  nextId,
} from './state.js'

// ── Spawn intervals ───────────────────────────────────────────────────────────

function spawnInterval(gameTime: number): number {
  // Seconds between spawn events (decreases with time)
  if (gameTime < 10)  return 2.4
  if (gameTime < 30)  return 1.8
  if (gameTime < 60)  return 1.3
  return 0.9
}

function groundObstacleChance(gameTime: number): number {
  if (gameTime < 5)  return 0
  if (gameTime < 15) return 0.35
  if (gameTime < 30) return 0.50
  return 0.60
}

function mynockChance(gameTime: number): number {
  if (gameTime < 10) return 0
  if (gameTime < 30) return 0.20
  if (gameTime < 60) return 0.35
  return 0.45
}

function vineChance(gameTime: number): number {
  if (gameTime < 20) return 0
  if (gameTime < 40) return 0.15
  if (gameTime < 60) return 0.25
  return 0.35
}

function logChance(gameTime: number): number {
  if (gameTime < 8)  return 0.3
  if (gameTime < 30) return 0.40
  return 0.30
}

function sinkingLogChance(gameTime: number): number {
  if (gameTime < 20) return 0
  if (gameTime < 40) return 0.3
  return 0.5
}

function essenceChance(gameTime: number): number {
  return gameTime < 5 ? 0.3 : 0.55
}

function holocronChance(_gameTime: number): number {
  return 0.08  // always rare
}

function biboChance(_gameTime: number): number {
  return 0.025  // very rare
}

// ── Main spawn function ───────────────────────────────────────────────────────

export function maybeSpawn(state: GameState, canvasW: number): void {
  const { gameTime } = state
  const interval = spawnInterval(gameTime)

  state.spawnTimer += 1 / 60  // called each frame, ~60fps
  if (state.spawnTimer < interval) return
  state.spawnTimer = 0

  const spawnX = canvasW + 80  // off-screen right

  // --- Ground obstacles (slime) ---
  if (Math.random() < groundObstacleChance(gameTime)) {
    if (!hasObstacleWithin(state, 'slime', spawnX, 200)) {
      spawnSlime(state, spawnX)
    }
  }

  // --- Mynock ---
  if (Math.random() < mynockChance(gameTime)) {
    const hasNearVine = hasObstacleWithin(state, 'vine', spawnX, 300)
    if (!hasNearVine) {
      spawnMynock(state, spawnX, state.groundY)
    }
  }

  // --- Vine with shadow ---
  if (Math.random() < vineChance(gameTime)) {
    if (!hasObstacleWithin(state, 'vine', spawnX, 500)) {
      spawnVine(state, spawnX + 60, canvasW)  // slightly further right
    }
  }

  // --- Log platform ---
  if (Math.random() < logChance(gameTime)) {
    const sinking = Math.random() < sinkingLogChance(gameTime)
    spawnLog(state, spawnX + 120, state.groundY, sinking)
  }

  // --- Pickups (separate timer would be cleaner but this works) ---
  if (Math.random() < biboChance(gameTime)) {
    spawnPickup(state, spawnX + 30, state.groundY, 'bibo')
  } else if (Math.random() < holocronChance(gameTime)) {
    spawnPickup(state, spawnX + 30, state.groundY, 'holocron')
  } else if (Math.random() < essenceChance(gameTime)) {
    spawnPickup(state, spawnX, state.groundY, 'essence')
  }

  // Solvability pass: remove impossible triple-stacks and vine bunching
  validateSolvability(state, canvasW)
}

// ── Obstacle factories ────────────────────────────────────────────────────────

function spawnSlime(state: GameState, x: number): void {
  const w = 30 + Math.random() * 30
  const ob: Obstacle = {
    id: nextId(state),
    x,
    y: state.groundY - 18,
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

function spawnMynock(state: GameState, x: number, groundY: number): void {
  // Mynocks fly at mid-height: player must be jumping (higher) or they pass below
  // They fly at groundY - 90 to groundY - 160 (player body range when grounded is groundY-64 to groundY)
  // So if mynock Y (top) is above groundY - PLAYER_HEIGHT, grounded player is hit
  // Make mynocks fly at groundY - 80 to groundY - 140 — mid-air threat
  const yTop = groundY - 70 - Math.random() * 60  // 70-130px above ground
  const ob: Obstacle = {
    id: nextId(state),
    x,
    y: yTop,
    width: 64,
    height: 28,
    type: 'mynock',
    pairId: 0,
    dropCountdown: 0,
    dropped: false,
    vy: (Math.random() - 0.5) * 40,  // slight up-down wobble
  }
  state.obstacles.push(ob)
}

function spawnVine(state: GameState, x: number, _canvasW: number): void {
  const pairId = nextId(state)
  const vineH = 40 + Math.random() * 80  // how far it drops

  // Shadow first (appears at ground level)
  const shadow: Obstacle = {
    id: nextId(state),
    x: x - 15,
    y: state.groundY - 6,
    width: 30,
    height: 10,
    type: 'vine_shadow',
    pairId,
    dropCountdown: 1.0,  // 1 second warning
    dropped: false,
    vy: 0,
  }

  // Vine (starts at top, drops after 1s)
  const vine: Obstacle = {
    id: nextId(state),
    x: x - 10,
    y: -vineH,   // starts above screen
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

// ── Platform factory ──────────────────────────────────────────────────────────

function spawnLog(
  state: GameState,
  x: number,
  groundY: number,
  sinking: boolean,
): void {
  const w = 90 + Math.random() * 60
  // Logs float 40-70px above ground level
  const yAbove = 40 + Math.random() * 30
  const logTopY = groundY - yAbove - 16  // top surface Y

  const pl: Platform = {
    id: nextId(state),
    x,
    y: logTopY,
    width: w,
    height: 16,
    type: sinking ? 'sinking_log' : 'log',
    sinkTimer: 0,
    sinking: false,
    sinkOffset: 0,
  }
  state.platforms.push(pl)
}

// ── Cooldown helper ──────────────────────────────────────────────────────

/**
 * Returns true if there's already an obstacle of `type` with x-position
 * within `distance` pixels of `spawnX` (looking at in-flight obstacles on the right side).
 */
function hasObstacleWithin(
  state: GameState,
  type: ObstacleType,
  spawnX: number,
  distance: number,
): boolean {
  return state.obstacles.some(
    (ob) => ob.type === type && ob.x > 0 && Math.abs(ob.x - spawnX) < distance,
  )
}

// ── Solvability validator ────────────────────────────────────────────────────

const SOLVABILITY_LOOKAHEAD = 600  // px forward window to inspect
const COLUMN_BIN_WIDTH = 80        // px bin size for column grouping
const VINE_MIN_GAP = 150           // px: two vines closer than this = one removed

/**
 * After each spawn event, scan the upcoming obstacle window and remove
 * configurations that create unjumpable stacks:
 *   1. Triple-stack: ground slime + overhead mynock + vine in the same 80px column
 *      — remove the newest obstacle (highest id).
 *   2. Two vines within 150px — remove the newer one.
 */
function validateSolvability(state: GameState, canvasW: number): void {
  const lookaheadEnd = canvasW + SOLVABILITY_LOOKAHEAD
  const inWindow = state.obstacles.filter((ob) => ob.x > 0 && ob.x < lookaheadEnd)

  // — Rule 2: paired vines too close together ————————————————————————
  const vines = inWindow.filter((ob) => ob.type === 'vine').sort((a, b) => a.x - b.x)
  for (let i = 0; i < vines.length - 1; i++) {
    const gap = Math.abs(vines[i + 1].x - vines[i].x)
    if (gap < VINE_MIN_GAP) {
      // Remove the newer vine (higher id) and its shadow
      const newerVine: Obstacle = vines[i].id > vines[i + 1].id ? vines[i] : vines[i + 1]
      console.debug(`[solvability] removed obstacle id=${newerVine.id}, reason=vine_too_close gap=${gap}px`)
      state.obstacles = state.obstacles.filter(
        (ob) => ob.id !== newerVine.id && !(ob.type === 'vine_shadow' && ob.pairId === newerVine.pairId),
      )
    }
  }

  // — Rule 1: triple-stack (slime + mynock + vine in same column) ————————
  // Group surviving obstacles by column bin
  const surviving = state.obstacles.filter((ob) => ob.x > 0 && ob.x < lookaheadEnd)
  const columns = new Map<number, Obstacle[]>()
  for (const ob of surviving) {
    const bin = Math.floor(ob.x / COLUMN_BIN_WIDTH)
    const col = columns.get(bin) ?? []
    col.push(ob)
    columns.set(bin, col)
  }

  for (const [, col] of columns) {
    const types = new Set(col.map((o) => o.type))
    if (types.has('slime') && types.has('mynock') && types.has('vine')) {
      // Triple-stack: remove newest obstacle in this column
      const newest = col.reduce((prev, cur) => (cur.id > prev.id ? cur : prev))
      console.debug(`[solvability] removed obstacle id=${newest.id}, reason=triple_stack col_bin=${Math.floor(newest.x / COLUMN_BIN_WIDTH)}`)
      state.obstacles = state.obstacles.filter((ob) => ob.id !== newest.id)
    }
  }
}

// ── Pickup factory ────────────────────────────────────────────────────────────

function spawnPickup(
  state: GameState,
  x: number,
  groundY: number,
  type: 'essence' | 'holocron' | 'bibo',
): void {
  let y: number
  if (type === 'essence') {
    y = groundY - 40 - Math.random() * 80
  } else if (type === 'holocron') {
    y = groundY - 60 - Math.random() * 60
  } else {
    // Bibo swims — show near ground level, slightly below
    y = groundY - 20
  }

  const pk: Pickup = {
    id: nextId(state),
    x,
    y,
    type,
    collected: false,
    glowPhase: Math.random() * Math.PI * 2,
  }
  state.pickups.push(pk)
}
