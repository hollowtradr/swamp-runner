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
import { startGame, stopGame, type GameStartOptions } from './game/index.js'
import { initHUD, showHUD, hideHUD, updateHUD } from './ui/HUD.js'
import { mountTitlePerksCard } from './ui/TitlePerksCard.js'

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

  // YODA-374: schedule a reactivation DM for tomorrow's play refresh.
  // Idempotent per day — calling at every session start is intentional.
  // Failure MUST NOT block gameplay.
  sdk.scheduleReactivation({ trigger: 'daily_reset' }).then((res) => {
    if (!res.success) {
      console.debug('[swamp-runner] scheduleReactivation skipped:', res.error)
    }
  }).catch((err) => {
    console.debug('[swamp-runner] scheduleReactivation threw (non-fatal):', err)
  })

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

  // Player meta strip pinned to the top (compact, low-weight).
  // Demo-mode banner replaces it when no session.
  const metaStripHtml = !isDemoMode
    ? `<div class="title-meta-strip">
         <span class="title-meta-name">${escapeHtml(displayName)}</span>
         <span class="title-meta-dot">·</span>
         <span class="title-meta-stat">⚡ ${midiBalance}</span>
         <span class="title-meta-dot">·</span>
         <span class="title-meta-stat">${playsLeft} run${playsLeft === 1 ? '' : 's'} left</span>
       </div>`
    : `<div class="title-meta-strip title-meta-demo">⚠️ Demo — launch from @stickergalaxybot</div>`

  titleEl.innerHTML = `
    <div class="title-bg">
      <div class="title-mist title-mist-1"></div>
      <div class="title-mist title-mist-2"></div>
    </div>

    <div class="god-rays" aria-hidden="true">
      <div class="god-ray god-ray-1"></div>
      <div class="god-ray god-ray-2"></div>
    </div>

    <div class="fireflies" aria-hidden="true">
      <div class="firefly"></div>
      <div class="firefly"></div>
      <div class="firefly"></div>
      <div class="firefly"></div>
      <div class="firefly"></div>
      <div class="firefly"></div>
    </div>

    ${metaStripHtml}

    <div class="title-content">
      <div class="title-hero">
        <picture>
          <source srcset="/sprites/v4/yoda_peace.webp" type="image/webp" />
          <img src="/sprites/v4/yoda_peace.gif" class="title-hero-img" alt="Baby Yoda" />
        </picture>
      </div>

      <div class="title-text-block">
        <div class="title-eyebrow">Sticker Galaxy Arcade</div>
        <h1 class="title-name"><span class="with-sigils">Swamp Runner</span></h1>
        <p class="title-tagline" id="title-tagline">
          Hop across Dagobah. Gather Force essence.<br>
          Train under Master Yoda's watch.
        </p>
      </div>

      <button id="play-btn" class="btn swamp-play-btn">
        ▶ Begin Training
      </button>

      <div class="title-controls-hint">
        <div class="title-control-row">
          <span class="control-key">TAP</span> <span>Jump</span>
        </div>
        <div class="title-control-row">
          <span class="control-key">HOLD</span> <span>Higher jump</span>
        </div>
      </div>

      <div class="title-icon-row">
        <button id="lb-btn" class="title-icon-btn" aria-label="Leaderboard">
          <span class="title-icon-glyph">🏆</span>
          <span class="title-icon-label">Leaderboard</span>
        </button>
        <button id="settings-btn" class="title-icon-btn" aria-label="Settings">
          <span class="title-icon-glyph">⚙️</span>
          <span class="title-icon-label">Settings</span>
        </button>
      </div>
    </div>
  `

  app.appendChild(titleEl)

  // Mount tier perks card below the button row.
  // Always mounted -- wallet mock works in demo mode too (localStorage-backed).
  const titleContent = titleEl.querySelector<HTMLElement>('.title-content')
  if (titleContent) {
    mountTitlePerksCard(titleContent)
  }

  // ---- Hollow Knight pass 2: tagline whisper + tap-burst ----
  animateTaglineWords(titleEl)
  attachTapBursts(titleEl)

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

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    import('./ui/SettingsModal.js').then(({ showSettingsModal }) => showSettingsModal())
  })
}

// ── Game flow ─────────────────────────────────────────────────────────────────

let _midiBalance: number | null = null
let _currentSession: SessionData | null = null
let _gameOpts: GameStartOptions = {}

async function beginGame(session: SessionData | null, opts: GameStartOptions = {}): Promise<void> {
  _currentSession = session
  _gameOpts = opts
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
  await startGame(onGameEnd, _gameOpts)

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
      // Play again → new entry (full restart). Preserve mode (daily stays daily).
      hideResultScreen()
      beginGame(_currentSession, _gameOpts)
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

// ── Hollow Knight title effects ──────────────────────────────────────────────

/**
 * Wrap each word in .title-tagline in a <span class="word"> with a staggered
 * animation-delay so the line whispers in word-by-word after the hero lands.
 * Preserves <br> elements; skips if user prefers reduced motion.
 */
function animateTaglineWords(titleEl: HTMLElement): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const tagline = titleEl.querySelector<HTMLElement>('#title-tagline')
  if (!tagline) return

  // Replace each text node with word-wrapped spans; keep <br> intact.
  const children: ChildNode[] = Array.from(tagline.childNodes)
  tagline.textContent = ''
  let wordIndex = 0
  const wordsBeforeFirstLine: number[] = []
  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) {
      const words = (node.textContent ?? '').trim().split(/\s+/).filter(Boolean)
      words.forEach((w) => {
        const span = document.createElement('span')
        span.className = 'word'
        span.textContent = w
        // 90ms per word, starting 0.4s after the title appears
        span.style.animationDelay = `${0.4 + wordIndex * 0.09}s`
        tagline.appendChild(span)
        tagline.appendChild(document.createTextNode(' '))
        wordsBeforeFirstLine.push(wordIndex)
        wordIndex += 1
      })
    } else {
      tagline.appendChild(node.cloneNode(true))
    }
  }
}

/**
 * Spawn a brief golden sparkle wherever the user taps on the title screen.
 * Adds tactile feedback without coupling to any specific button. Bursts auto-
 * remove after the CSS animation completes.
 */
function attachTapBursts(titleEl: HTMLElement): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const spawn = (clientX: number, clientY: number): void => {
    const rect = titleEl.getBoundingClientRect()
    const burst = document.createElement('div')
    burst.className = 'tap-burst'
    burst.style.left = `${clientX - rect.left}px`
    burst.style.top  = `${clientY - rect.top}px`
    titleEl.appendChild(burst)
    setTimeout(() => burst.remove(), 900)
  }
  titleEl.addEventListener('pointerdown', (e) => {
    // Ignore taps on actual interactive controls so we don't double-fire.
    const target = e.target as HTMLElement | null
    if (target?.closest('button, a, input, label, .settings-toggle')) return
    spawn(e.clientX, e.clientY)
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('[swamp-runner] Fatal:', err)
  setLoadingMessage(`Fatal error: ${(err as Error).message}`, true)
})
