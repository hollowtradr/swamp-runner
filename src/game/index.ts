/**
 * src/game/index.ts — Swamp Runner game controller (Phaser 3)
 *
 * Public API (UNCHANGED from Canvas2D version):
 *   startGame(onEnd, opts?)  — begins a play session
 *   stopGame()               — cancels the loop (e.g., session killed)
 *   getGameState()           — returns current state (for HUD polling)
 *   getGameOverQuote()       — random end-quote for result screen
 *
 * Phase 1 esport additions:
 *   - opts.mode / opts.seed control run mode
 *   - Seeded RNG initialized in createInitialState
 *   - Replay + PB ghost saved to localStorage on run end
 */

import Phaser from 'phaser'
import {
  createInitialState,
  applyRevive,
  type GameState,
  GAME_OVER_QUOTES,
  type Mode,
  GhostTrack,
} from './state.js'
import { SwampScene } from './phaser-scene.js'
import {
  createReplay,
  serialize,
  deserialize,
  dailySeedForToday,
  type Replay,
  type GhostSample,
} from 'sticker-galaxy-sdk-core'
import { SWAMP_RUNNER_CHUNKS } from '../chunks/index.js'

type GameEndCallback = (score: number, outcome: 'win' | 'loss') => void

// ── Module state ──────────────────────────────────────────────────────────────

let _game: Phaser.Game | null = null
let _state: GameState | null = null
let _onEnd: GameEndCallback | null = null
let _currentReplay: Replay | null = null

// ── Build hash (Phase 2: bumped to phase2; Phase 3: content hash) ──────────
const BUILD_HASH = '1.0.0-phase2'

/** True when ?legacy=1 is in the URL — forces IID spawner for A/B. */
const LEGACY_MODE = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('legacy')

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_PB_GHOST = 'swamp_runner:pb_ghost'
const LS_LATEST_REPLAY = 'swamp_runner:latest_replay'

// ── Public options ────────────────────────────────────────────────────────────

export interface GameStartOptions {
  mode?: Mode
  /** Override seed (casual uses crypto random if unset; daily derives from date). */
  seed?: number
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startGame(
  onEnd: GameEndCallback,
  opts: GameStartOptions = {},
): Promise<void> {
  _onEnd = onEnd

  // Destroy any previous game instance
  if (_game) {
    _game.destroy(false, false)
    _game = null
  }

  const mode: Mode = opts.mode ?? 'casual'
  const seed = resolveSeed(mode, opts.seed)

  console.log(`[esport] run start — mode=${mode} seed=${seed} build=${BUILD_HASH}`)

  const w = window.innerWidth
  const h = window.innerHeight

  // Daily mode always uses chunks; ?legacy=1 forces IID for one-release A/B.
  // Chunks are passed to createInitialState; if LEGACY_MODE the factory
  // receives an empty array which triggers the 'iid' spawnMode.
  const chunksForRun = (LEGACY_MODE && mode !== 'daily') ? [] : SWAMP_RUNNER_CHUNKS
  if (LEGACY_MODE && mode !== 'daily') {
    console.log('[esport] ?legacy=1 — using IID spawner')
  }

  _state = createInitialState(w, h, seed, mode, chunksForRun)
  _state.phase = 'playing'

  // Load PB ghost from localStorage
  _state.pbGhostTrack = loadPBGhost(_state.seed, mode)
  // Default OFF: casual runs use a fresh random seed each time, so a saved
  // ghost almost never matches the current course and is mostly distraction.
  // Settings lets PB-chasers opt in.
  const ghostPref = localStorage.getItem('swamp_runner:show_ghost') === 'true'
  _state.showGhost = _state.pbGhostTrack !== null && ghostPref

  // Initialize replay
  _currentReplay = createReplay(seed, mode, BUILD_HASH)

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement

  _game = new Phaser.Game({
    type: Phaser.CANVAS,
    canvas,
    width: w,
    height: h,
    backgroundColor: '#1a3320',
    transparent: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 2,
    },
    // No physics plugin needed — we run our own fixed-step physics
    physics: undefined,
    // Disable audio to keep bundle lean and avoid Telegram iframe restrictions
    audio: { disableWebAudio: true, noAudio: true },
    // Disable Phaser's default banner in console
    banner: false,
    scene: [],  // scenes added manually below so we can pass state data
  })

  // Listen for game-end event from scene
  _game.events.once('gameEnd', ({ score, outcome }: { score: number; outcome: 'win' | 'loss' }) => {
    handleRunEnd(score)
    _onEnd?.(score, outcome)
  })

  // Start scene once Phaser is ready
  _game.events.once('ready', () => {
    _game!.scene.add('SwampScene', SwampScene, true, {
      state: _state!,
      onEnd: _onEnd!,
      replay: _currentReplay!,
    })
  })
}

export function stopGame(): void {
  if (_game) {
    _game.destroy(false, false)
    _game = null
  }
  _state = null
  _currentReplay = null
}

/**
 * Revive an ended run in place: keep score, distance, midi, gameTime, world
 * scroll. Reset only the player + clear a safety window of nearby hazards.
 *
 * Returns true on success, false if there is no current ended run to revive
 * (e.g. game was already stopped or never started).
 */
export function reviveGame(): boolean {
  if (!_state || !_game) return false
  // Apply state-level revive (player, safety bubble, shield).
  applyRevive(_state)
  // Drop scene-level guards so the gameEnd event can fire again on next death.
  const scene = _game.scene.getScene('SwampScene') as SwampScene | null
  if (scene && typeof scene.resetForRevive === 'function') {
    scene.resetForRevive()
  }
  // Re-arm a one-shot gameEnd listener so the next death surfaces correctly.
  _game.events.once('gameEnd', ({ score, outcome }: { score: number; outcome: 'win' | 'loss' }) => {
    handleRunEnd(score)
    _onEnd?.(score, outcome)
  })
  // Finally, flip phase back to 'playing' AFTER guards are cleared.
  _state.phase = 'playing'
  return true
}

export function getGameState(): GameState | null {
  return _state
}

// ── Export game-over quote helper ─────────────────────────────────────────────

export function getGameOverQuote(): string {
  return GAME_OVER_QUOTES[Math.floor(Math.random() * GAME_OVER_QUOTES.length)]
}

// ── Seed resolution ────────────────────────────────────────────────────────────

function resolveSeed(mode: Mode, overrideSeed?: number): number {
  if (overrideSeed !== undefined) return overrideSeed >>> 0

  if (mode === 'daily') {
    return dailySeedForToday('swamp_runner')
  }

  // Check URL param for practice/debug
  const urlSeed = new URLSearchParams(window.location.search).get('seed')
  if (urlSeed) {
    const parsed = parseInt(urlSeed, 10)
    if (!isNaN(parsed)) return parsed >>> 0
  }

  // Casual: cryptographically random seed
  return (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0
}

// ── PB ghost persistence ──────────────────────────────────────────────────────

interface StoredGhost {
  seed: number
  mode: string
  score: number
  samples: GhostSample[]
}

function loadPBGhost(seed: number, mode: Mode): GhostTrack | null {
  try {
    const raw = localStorage.getItem(LS_PB_GHOST)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredGhost
    if (!Array.isArray(stored.samples) || stored.samples.length === 0) return null

    // Daily: only load if seed matches (same daily seed = same level)
    if (mode === 'daily' && stored.seed !== seed) return null
    // Casual: always load regardless of seed (PB is "your best casual run")
    // Other modes: no ghost in Phase 1

    if (mode !== 'casual' && mode !== 'daily') return null

    return new GhostTrack(stored.samples)
  } catch {
    return null
  }
}

function savePBGhost(seed: number, mode: Mode, score: number, samples: GhostSample[]): void {
  try {
    const stored: StoredGhost = { seed, mode, score, samples }
    localStorage.setItem(LS_PB_GHOST, JSON.stringify(stored))
  } catch {
    // localStorage full or unavailable — ignore
  }
}

function getCurrentPBScore(): number {
  try {
    const raw = localStorage.getItem(LS_PB_GHOST)
    if (!raw) return 0
    const stored = JSON.parse(raw) as StoredGhost
    return stored.score ?? 0
  } catch {
    return 0
  }
}

// ── Run end handler ────────────────────────────────────────────────────────────

function handleRunEnd(score: number): void {
  if (!_state || !_currentReplay) return

  _currentReplay.final_score = score
  _currentReplay.ghost_samples = [..._state.ghostSamples]

  // Persist latest replay
  try {
    localStorage.setItem(LS_LATEST_REPLAY, serialize(_currentReplay))
  } catch { /* ignore */ }

  // Update PB ghost if score improved
  const mode = _state.mode
  if ((mode === 'casual' || mode === 'daily') && score > getCurrentPBScore()) {
    savePBGhost(_state.seed, mode, score, _state.ghostSamples)
    console.log(`[esport] new PB! score=${score} seed=${_state.seed} ghost_samples=${_state.ghostSamples.length}`)
  }

  console.log(`[esport] run end — score=${score} ticks=${_state.tick} inputs=${_currentReplay.inputs.length}`)
}

// ── Debug / dev exports ────────────────────────────────────────────────────────

export function getLatestReplay(): Replay | null {
  try {
    const raw = localStorage.getItem(LS_LATEST_REPLAY)
    return raw ? deserialize(raw) : null
  } catch {
    return null
  }
}
