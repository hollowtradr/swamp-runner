/**
 * src/main.ts — Swamp Runner entry point
 *
 * Flow:
 *   1. tgReady()          — signal Telegram, expand viewport
 *   2. initSDK()          — read session_token / game_id from URL
 *   3. initSession()      — validate with host API
 *   4. showTitleScreen()  — hero screen with Baby Yoda art
 *   5. On "Play" tap:
 *      a. postEntry(0)    — free-to-play (0 midi)
 *      b. startGame()     — run the game loop
 *   6. On game end:
 *      a. showResultScreen() — post result, show midi/trophy/rank
 *   7. "Run Again" → back to step 5
 */

import './style.css'
import * as sdk from './sdk.js'
import { tgReady, tgBackButton } from './tg.js'
import { startGame, stopGame } from './game/index.js'
import { initHUD, showHUD, hideHUD, updateHUD } from './ui/HUD.js'
import { mountTitlePerksCard } from './ui/TitlePerksCard.js'
import { mountSettingsLink } from './ui/SettingsLink.js'
import {
  initResultScreen,
  setEntryContext,
  showResultScreen,
  hideResultScreen,
} from './ui/ResultScreen.js'
import { onHostMessage, postMessageBridge } from './sdk.js'
import { loadAllSprites } from './game/assets.js'
import { getGameState } from './game/index.js'

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  tgReady()
  sdk.initSDK()
  initHUD()
  initResultScreen()

  // Host message hooks
  onHostMessage('SESSION_EXPIRING', () => {
    console.warn('[swamp-runner] Session expiring — saving state')
    stopGame()
  })
  onHostMessage('SESSION_KILLED', () => stopGame())
  onHostMessage('PURCHASE_CONFIRMED', (data) => console.log('[swamp-runner] Purchase:', data))

  // Back button → exit cleanly
  tgBackButton(() => {
    stopGame()
    postMessageBridge('GAME_COMPLETE', { entry_id: '' })
  })

  postMessageBridge('GAME_READY')

  // Pre-load sprites in background while showing loading screen
  loadAllSprites().catch(() => {/* sprites degrade to drawn fallback */})

  // Show loading, validate session
  setLoadingMessage('Entering the Dagobah swamp…')
  const sessionResult = await sdk.initSession()

  if (!sessionResult.success) {
    setLoadingMessage(
      sdk.hasToken()
        ? `Connection error: ${sessionResult.error}`
        : 'No session token found.\n\nFor local dev: add ?session_token=dev to the URL.\nLaunch from @stickergalaxybot for real rewards.',
      true,
    )
    setTimeout(() => showTitleScreen(null), 1800)
    return
  }

  hideLoading()
  showTitleScreen(sessionResult.data)
}

// ── Title screen ──────────────────────────────────────────────────────────────

interface SessionData {
  display_name: string
  midi_balance: number
  daily_plays_remaining: number
}

function showTitleScreen(session: SessionData | null): void {
  // Remove any existing title screen
  document.getElementById('title-screen')?.remove()

  const app = document.getElementById('app')!
  const titleEl = document.createElement('div')
  titleEl.id = 'title-screen'

  const isDemoMode = session === null
  const playsLeft  = session?.daily_plays_remaining ?? '∞'
  const midiBalance = session?.midi_balance ?? '—'
  const displayName = session?.display_name ?? 'Wanderer'

  titleEl.innerHTML = `
    <div class="title-bg">
      <div class="title-mist title-mist-1"></div>
      <div class="title-mist title-mist-2"></div>
    </div>

    <div class="title-content">
      <div class="title-hero">
        <img src="/sprites/baby_yoda_title.png" class="title-hero-img" alt="Baby Yoda" />
      </div>

      <div class="title-text-block">
        <div class="title-eyebrow">Sticker Galaxy Arcade</div>
        <h1 class="title-name">Swamp Runner</h1>
        <p class="title-tagline">
          Hop across Dagobah. Gather Force essence.<br>
          Train under Master Yoda's watch.
        </p>
      </div>

      ${!isDemoMode ? `
      <div class="title-player-card">
        <span class="title-player-name">${escapeHtml(displayName)}</span>
        <div class="title-player-stats">
          <span>⚡ ${midiBalance} midi</span>
          <span class="title-divider">·</span>
          <span>${playsLeft} run${playsLeft === 1 ? '' : 's'} left today</span>
        </div>
      </div>` : `
      <div class="title-demo-badge">⚠️ Demo mode — launch from @stickergalaxybot for rewards</div>
      `}

      <div class="title-controls-hint">
        <div class="title-control-row">
          <span class="control-key">TAP</span> <span>Jump</span>
        </div>
        <div class="title-control-row">
          <span class="control-key">HOLD</span> <span>Higher jump</span>
        </div>
      </div>

      <button id="play-btn" class="btn swamp-play-btn">
        ▶ Begin Training
      </button>
      <button id="lb-btn" class="btn btn-ghost swamp-ghost-btn">
        🏆 Leaderboard
      </button>
    </div>
  `

  app.appendChild(titleEl)

  // Mount tier perks card below the button row.
  // Always mounted -- wallet mock works in demo mode too (localStorage-backed).
  const titleContent = titleEl.querySelector<HTMLElement>('.title-content')
  if (titleContent) {
    mountTitlePerksCard(titleContent)
    mountSettingsLink(titleContent)
  }

  document.getElementById('play-btn')?.addEventListener('click', () => {
    titleEl.classList.add('fade-out')
    setTimeout(() => {
      titleEl.remove()
      beginGame(session)
    }, 300)
  })

  document.getElementById('lb-btn')?.addEventListener('click', () => {
    import('./ui/Leaderboard.js').then(({ showLeaderboard }) => showLeaderboard())
  })
}

// ── Game flow ─────────────────────────────────────────────────────────────────

let _midiBalance: number | null = null
let _currentSession: SessionData | null = null

async function beginGame(session: SessionData | null): Promise<void> {
  _currentSession = session
  _midiBalance = session?.midi_balance ?? null

  // Post entry — free-to-play
  const entryResult = await sdk.postEntry(0, 'Swamp Runner entry')
  let entryId = ''

  if (entryResult.success) {
    entryId = entryResult.data.entry_id
    _midiBalance = entryResult.data.new_midi_balance
  } else {
    console.warn('[swamp-runner] postEntry failed (demo/dev mode):', entryResult.error)
  }

  const gameStartTime = performance.now()
  setEntryContext(entryId, gameStartTime)

  showHUD()
  await startGame(onGameEnd)

  // HUD polling (canvas renders the score; DOM HUD shows midi balance).
  // Wrapped in a restartable function so revive can re-arm it after the
  // first run ended (which auto-clears the interval on 'ended' phase).
  function startHudPolling(): void {
    const hudInterval = setInterval(() => {
      const state = getGameState()
      updateHUD(state, _midiBalance)
      if (!state || state.phase === 'ended') clearInterval(hudInterval)
    }, 150)
  }
  startHudPolling()
  _restartHudPolling = startHudPolling
}

// HUD polling re-arm hook — set by beginGame, called by onRevive.
let _restartHudPolling: (() => void) | null = null

function onGameEnd(score: number, outcome: 'win' | 'loss'): void {
  hideHUD()
  showResultScreen(
    score,
    outcome,
    () => {
      // Play again → new entry (full restart).
      hideResultScreen()
      beginGame(_currentSession)
    },
    () => {
      // Revive → resume the same run with player reset + safety bubble.
      hideResultScreen()
      showHUD()
      _restartHudPolling?.()
    },
  )
}

// ── Loading helpers ───────────────────────────────────────────────────────────

function setLoadingMessage(msg: string, isError = false): void {
  const el = document.getElementById('loading-message')
  if (!el) return
  el.innerHTML = msg.replace(/\n/g, '<br>')
  if (isError) {
    el.style.color = '#ef4444'
    const spinner = document.querySelector('.spinner') as HTMLElement | null
    if (spinner) spinner.style.display = 'none'
  }
}

function hideLoading(): void {
  const el = document.getElementById('loading-screen')
  el?.classList.add('hidden')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Boot ──────────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('[swamp-runner] Fatal:', err)
  setLoadingMessage(`Fatal error: ${(err as Error).message}`, true)
})
