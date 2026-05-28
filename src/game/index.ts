/**
 * src/game/index.ts — Swamp Runner game controller (Phaser 3)
 *
 * Public API (UNCHANGED from Canvas2D version):
 *   startGame(onEnd)   — begins a play session
 *   stopGame()         — cancels the loop (e.g., session killed)
 *   getGameState()     — returns current state (for HUD polling)
 *   getGameOverQuote() — random end-quote for result screen
 *
 * Phaser owns all rendering. Physics/state/spawn logic is unchanged.
 */

import Phaser from 'phaser'
import { createInitialState, applyRevive, type GameState, GAME_OVER_QUOTES } from './state.js'
import { SwampScene } from './phaser-scene.js'

type GameEndCallback = (score: number, outcome: 'win' | 'loss') => void

// ── Module state ──────────────────────────────────────────────────────────────

let _game: Phaser.Game | null = null
let _state: GameState | null = null
let _onEnd: GameEndCallback | null = null

// ── Public API ────────────────────────────────────────────────────────────────

export async function startGame(onEnd: GameEndCallback): Promise<void> {
  _onEnd = onEnd

  // Destroy any previous game instance
  if (_game) {
    _game.destroy(false, false)
    _game = null
  }

  const w = window.innerWidth
  const h = window.innerHeight

  _state = createInitialState(w, h)
  _state.phase = 'playing'

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
    // No physics plugin needed — we run our own physics
    physics: undefined,
    // Disable audio to keep bundle lean and avoid Telegram iframe restrictions
    audio: { disableWebAudio: true, noAudio: true },
    // Disable Phaser's default banner in console
    banner: false,
    scene: [],  // scenes added manually below so we can pass state data
  })

  // Listen for game-end event from scene
  _game.events.once('gameEnd', ({ score, outcome }: { score: number; outcome: 'win' | 'loss' }) => {
    _onEnd?.(score, outcome)
  })

  // Start scene once Phaser is ready
  _game.events.once('ready', () => {
    _game!.scene.add('SwampScene', SwampScene, true, {
      state: _state!,
      onEnd: _onEnd!,
    })
  })
}

export function stopGame(): void {
  if (_game) {
    _game.destroy(false, false)
    _game = null
  }
  _state = null
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
