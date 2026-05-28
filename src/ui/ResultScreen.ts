/**
 * src/ui/ResultScreen.ts — Swamp Runner result screen
 *
 * Flow on game-over:
 *   1. [loss only, first death] Revive offer — 5s countdown, 3 purchase buttons
 *   2. Final result — score, midi, rank, submit button
 *      + daily-plays-exhausted card (when daily cap hit)
 *      + cosmetic shelf (always visible after a run)
 *
 * Follows SDK spec: POST /arcade/v0/result → /arcade/v0/submit.
 */

import * as sdk from '../sdk.js'
import { type HolderTier } from '../sdk.js'
import { tgHaptic, tgMainButton } from '../tg.js'
import { getGameOverQuote } from '../game/index.js'
import { getSprites } from '../game/assets.js'

let _el: HTMLElement | null = null
let _entryId = ''
let _startTime = 0

/** Tracks whether the player has already used a revive this run (resets per run). */
let _hasRevived = false

export function initResultScreen(): void {
  _el = document.getElementById('result-screen')!
}

export function setEntryContext(entryId: string, startTimeMs: number): void {
  _entryId = entryId
  _startTime = startTimeMs
  _hasRevived = false  // new run begins
}

// ── Tier perk tables (mirrors manifest.json yoda_tier_perks) ─────────────────

const FREE_REVIVES_PER_DAY: Record<HolderTier, number> = {
  initiate: 0, padawan: 0, knight: 1, master: 2, grandmaster: 3,
}

const COSMETIC_DISCOUNT_PCT: Record<HolderTier, number> = {
  initiate: 0, padawan: 5, knight: 15, master: 20, grandmaster: 25,
}

const DAILY_PLAYS: Record<HolderTier, number> = {
  initiate: 3, padawan: 4, knight: 5, master: 6, grandmaster: 7,
}

const TIER_LABELS: Record<HolderTier, string> = {
  initiate: 'Initiate', padawan: 'Padawan', knight: 'Knight',
  master: 'Master', grandmaster: 'Grandmaster',
}

const NEXT_TIER_INFO: Record<HolderTier, { nextTier: string; holdReq: string; nextTierKey: HolderTier } | null> = {
  initiate:    { nextTier: 'Padawan',      holdReq: '1k',    nextTierKey: 'padawan' },
  padawan:     { nextTier: 'Knight',       holdReq: '10k',   nextTierKey: 'knight' },
  knight:      { nextTier: 'Master',       holdReq: '100k',  nextTierKey: 'master' },
  master:      { nextTier: 'Grandmaster',  holdReq: '500k',  nextTierKey: 'grandmaster' },
  grandmaster: null,
}

// ── Featured cosmetics (rotating shelf) ──────────────────────────────────────

interface CosmeticItem {
  name: string
  tonPrice: number
  yodaBase: number
  itemId: string
  itemType: 'cosmetic_skin' | 'extra_play' | 'tournament_entry'
}

const FEATURED_COSMETICS: CosmeticItem[] = [
  { name: 'Jedi Robes',   tonPrice: 1.0, yodaBase: 450,  itemId: 'jedi_robes',   itemType: 'cosmetic_skin' },
  { name: 'Dark Robes',   tonPrice: 1.0, yodaBase: 450,  itemId: 'dark_robes',   itemType: 'cosmetic_skin' },
  { name: 'Holocron Pet', tonPrice: 5.0, yodaBase: 2300, itemId: 'holocron_pet', itemType: 'cosmetic_skin' },
]

// ── Free-revive daily counter (localStorage) ──────────────────────────────────

function freeReviveKey(): string {
  return `swamp_runner_free_revives_${new Date().toISOString().slice(0, 10)}`
}

function getFreeRevivesUsedToday(): number {
  return parseInt(localStorage.getItem(freeReviveKey()) ?? '0', 10)
}

function incrementFreeRevivesUsed(): void {
  localStorage.setItem(freeReviveKey(), String(getFreeRevivesUsedToday() + 1))
}

// ── Public entry point ────────────────────────────────────────────────────────

export function showResultScreen(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
  onPlayAgain: () => void,
): void {
  if (!_el) return
  _el.classList.remove('hidden')

  // Show revive offer first for loss runs, unless player already revived this run
  if (outcome === 'loss' && !_hasRevived) {
    renderReviveOffer(score, outcome, onPlayAgain)
  } else {
    renderFinalResult(score, outcome, onPlayAgain)
  }
}

export function hideResultScreen(): void {
  _el?.classList.add('hidden')
}

// ── Revive offer screen ───────────────────────────────────────────────────────

function renderReviveOffer(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
  onPlayAgain: () => void,
): void {
  if (!_el) return

  const tier          = sdk.getHolderTier()
  const freePerDay    = FREE_REVIVES_PER_DAY[tier]
  const freeUsed      = getFreeRevivesUsedToday()
  const hasFreeRevive = freePerDay > 0 && freeUsed < freePerDay
  const isLowTier     = tier === 'initiate' || tier === 'padawan'

  _el.innerHTML = `
    <div class="result-scroll">
      <div class="result-scroll-inner revive-offer">
        <div class="revive-title">"Force essence enough, you have. Continue?"</div>

        <div class="revive-countdown-wrap">
          <div class="revive-countdown-bar" id="revive-bar"></div>
        </div>
        <div class="revive-timer-label" id="revive-timer">5</div>

        <div class="revive-buttons">
          ${hasFreeRevive ? `
            <button class="btn btn-success swamp-btn revive-btn revive-btn-free" id="revive-free">
              🎁 Use Free Revive
              <span class="revive-btn-sub">${freeUsed + 1}/${freePerDay} used today</span>
            </button>
          ` : `
            <button class="btn btn-primary swamp-btn revive-btn" id="revive-ton">
              0.5 TON
            </button>
            <button class="btn btn-primary swamp-btn revive-btn" id="revive-stars">
              50 ⭐
            </button>
            <button class="btn btn-primary swamp-btn revive-btn" id="revive-yoda">
              250 YODA
              <span class="revive-discount-badge">−$0.04 vs TON</span>
            </button>
          `}
        </div>

        ${isLowTier ? `
          <div class="revive-upsell">
            Hold 10k YODA (~$37) = 1 free revive/day forever.
          </div>
        ` : ''}

        <button class="btn btn-ghost revive-skip" id="revive-skip">No thanks</button>
      </div>
    </div>
  `

  // 5-second countdown
  let secsLeft = 5
  const timerEl = document.getElementById('revive-timer')
  const barEl   = document.getElementById('revive-bar')
  let autoTimer: ReturnType<typeof setInterval> | null = null

  function startCountdown(): void {
    autoTimer = setInterval(() => {
      secsLeft--
      if (timerEl) timerEl.textContent = String(secsLeft)
      if (barEl)   barEl.style.width   = `${(secsLeft / 5) * 100}%`
      if (secsLeft <= 0) {
        clearInterval(autoTimer!)
        renderFinalResult(score, outcome, onPlayAgain)
      }
    }, 1000)
  }

  function cancelCountdown(): void {
    if (autoTimer) clearInterval(autoTimer)
  }

  async function handlePaidRevive(currency: 'TON' | 'Stars' | 'YODA', price: number): Promise<void> {
    cancelCountdown()
    const btn = document.querySelector<HTMLButtonElement>(`#revive-${currency.toLowerCase()}`)
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…' }

    const resp = await sdk.requestPurchase('extra_play', 'revive', price, 'Continue run', currency)
    if (resp.success) {
      _hasRevived = true
      hideResultScreen()
      onPlayAgain()  // NOTE: true in-run state revival (reset player pos etc.) is game-loop scope; PR 1 ships the purchase flow
    } else {
      // Purchase failed or cancelled — fall through to result
      renderFinalResult(score, outcome, onPlayAgain)
    }
  }

  function handleFreeRevive(): void {
    cancelCountdown()
    incrementFreeRevivesUsed()
    _hasRevived = true
    hideResultScreen()
    onPlayAgain()
  }

  // Bind buttons
  document.getElementById('revive-ton')?.addEventListener('click', () => handlePaidRevive('TON', 0.5))
  document.getElementById('revive-stars')?.addEventListener('click', () => handlePaidRevive('Stars', 50))
  document.getElementById('revive-yoda')?.addEventListener('click', () => handlePaidRevive('YODA', 250))
  document.getElementById('revive-free')?.addEventListener('click', handleFreeRevive)
  document.getElementById('revive-skip')?.addEventListener('click', () => {
    cancelCountdown()
    renderFinalResult(score, outcome, onPlayAgain)
  })

  startCountdown()
}

// ── Final result screen ───────────────────────────────────────────────────────

function renderFinalResult(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
  onPlayAgain: () => void,
): void {
  if (!_el) return

  const quote    = getGameOverQuote()
  const sprites  = getSprites()
  const isWin    = outcome === 'win'
  const tier     = sdk.getHolderTier()
  const playsRem = sdk.getDailyPlaysRemaining()

  const spriteEl = sprites.yodaVictory && isWin
    ? `<img src="${sprites.yodaVictory.src}" class="result-sprite" alt="Victory!" />`
    : sprites.yodaDefeat
      ? `<img src="${sprites.yodaDefeat.src}" class="result-sprite" alt="Defeat" />`
      : `<div style="font-size:80px">${isWin ? '🏆' : '💀'}</div>`

  _el.innerHTML = `
    <div class="result-scroll">
      <div class="result-scroll-inner">
        ${spriteEl}

        <div class="result-parchment">
          <div class="result-title-text">${isWin ? 'Run Complete' : 'The Force Fades'}</div>

          <div class="result-quote">"${quote}"</div>

          <div class="result-score-block">
            <div class="result-score-label">Force-paces traveled</div>
            <div class="result-score-value" id="result-score-val">${score.toLocaleString()}</div>
          </div>

          <div class="result-midi-block">
            <div class="result-midi-label">Midi Earned</div>
            <div class="result-midi-value" id="result-midi-val">
              <span class="midi-spinner">…</span>
            </div>
          </div>

          <div class="result-trophy hidden" id="result-trophy"></div>
          <div class="result-rank" id="result-rank"></div>

          ${playsRem <= 0 ? renderDailyPlaysCard(tier) : ''}
        </div>

        ${renderCosmeticShelf(tier)}

        <div class="result-actions">
          <button class="btn btn-primary swamp-btn" id="result-play-again">
            🌿 Run Again
          </button>
          <button class="btn btn-ghost swamp-btn-ghost" id="result-back">
            ← Back to Arcade
          </button>
          <button class="btn btn-ghost swamp-btn-ghost" id="result-lb" style="margin-top:4px;">
            🏆 Leaderboard
          </button>
        </div>
      </div>
    </div>
  `

  // Bind buttons
  document.getElementById('result-play-again')?.addEventListener('click', () => {
    hideResultScreen()
    onPlayAgain()
  })

  document.getElementById('result-back')?.addEventListener('click', () => {
    sdk.postMessageBridge('GAME_COMPLETE', { entry_id: _entryId })
    window.Telegram?.WebApp?.close?.()
  })

  document.getElementById('result-lb')?.addEventListener('click', () => {
    import('./Leaderboard.js').then(({ showLeaderboard }) => showLeaderboard())
  })

  // Cosmetic shelf buy buttons
  const shelfBuyBtn = document.getElementById('cosmetic-shelf-buy')
  if (shelfBuyBtn) {
    const cosmeticIdx = Math.floor(Date.now() / 1000) % FEATURED_COSMETICS.length  // stable per session second
    const cosmetic    = FEATURED_COSMETICS[cosmeticIdx]
    shelfBuyBtn.addEventListener('click', () => {
      sdk.requestPurchase(
        cosmetic.itemType,
        cosmetic.itemId,
        cosmetic.tonPrice,
        `${cosmetic.name} cosmetic`,
        'TON',
      ).catch(console.error)
    })
  }

  tgMainButton('Run Again', () => {
    hideResultScreen()
    onPlayAgain()
  })

  postGameResult(score, outcome).catch(console.error)
}

// ── Daily-plays-exhausted card ────────────────────────────────────────────────

function renderDailyPlaysCard(tier: HolderTier): string {
  const playsNow  = DAILY_PLAYS[tier]
  const nextInfo  = NEXT_TIER_INFO[tier]
  const tierLabel = TIER_LABELS[tier]

  const upgradeHint = nextInfo
    ? `<div class="daily-plays-upgrade">
        ${tierLabel}: ${playsNow}/day → Hold ${nextInfo.holdReq} YODA → ${nextInfo.nextTier}: ${DAILY_PLAYS[nextInfo.nextTierKey]}/day
       </div>
       <a class="btn btn-ghost swamp-btn-ghost daily-plays-cta"
          href="https://app.ston.fi/swap?ft=TON&tt=YODA"
          target="_blank" rel="noopener noreferrer">
         Get YODA ↗
       </a>`
    : `<div class="daily-plays-upgrade">You're already at Grandmaster — max plays unlocked!</div>`

  return `
    <div class="daily-plays-card">
      <div class="daily-plays-title">Daily plays exhausted (${playsNow}/${playsNow})</div>
      ${upgradeHint}
    </div>
  `
}

// ── Cosmetic shelf ────────────────────────────────────────────────────────────

function renderCosmeticShelf(tier: HolderTier): string {
  const discountPct = COSMETIC_DISCOUNT_PCT[tier]
  // Cycle through 3 items, stable within a session (changes each second but consistent enough)
  const idx      = Math.floor(Date.now() / 1000) % FEATURED_COSMETICS.length
  const cosmetic = FEATURED_COSMETICS[idx]

  const discountedYoda = Math.round(cosmetic.yodaBase * (1 - discountPct / 100))
  const discountBadge  = discountPct > 0
    ? `<span class="cosmetic-discount-badge">${discountPct}% off — ${discountedYoda} YODA</span>`
    : `<span class="cosmetic-yoda-price">${cosmetic.yodaBase} YODA</span>`

  return `
    <div class="cosmetic-shelf">
      <div class="cosmetic-shelf-label">✨ Featured</div>
      <div class="cosmetic-shelf-item">
        <span class="cosmetic-shelf-name">${cosmetic.name}</span>
        <span class="cosmetic-shelf-ton">${cosmetic.tonPrice} TON</span>
        ${discountBadge}
        <button class="btn btn-ghost swamp-btn-ghost cosmetic-shelf-btn" id="cosmetic-shelf-buy">
          Get it
        </button>
      </div>
    </div>
  `
}

// ── Internal: post game result ────────────────────────────────────────────────

async function postGameResult(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
): Promise<void> {
  const durationSecs = Math.round((performance.now() - _startTime) / 1000)

  /**
   * REAL SDK CALL — shape:
   * { entry_id, user_id, score, outcome, proof_of_play_token, play_duration_seconds, metadata }
   *
   * When no real session token exists (local dev), the API returns an error;
   * we fall through to mock data so the UI is still testable.
   */
  const result = await sdk.postResult(_entryId, {
    score,
    outcome,
    play_duration_seconds: Math.max(1, durationSecs),
    metadata: {
      game: 'swamp_runner',
      pickups_collected: 0,   // TODO: thread from state — phase 2
      max_speed_reached: 0,
      longest_combo: 0,
    },
  })

  renderResultData(result)
}

function renderResultData(result: sdk.SDKResponse<sdk.ResultData>): void {
  const midiEl   = document.getElementById('result-midi-val')
  const rankEl   = document.getElementById('result-rank')
  const trophyEl = document.getElementById('result-trophy')

  if (!result.success) {
    if (midiEl) {
      const errMsg = (result.error || '').toLowerCase()
      if (errMsg.includes('no session') || errMsg.includes('unauthorized')) {
        midiEl.innerHTML = `
          <span class="midi-mock">Demo Mode</span>
          <div class="midi-note">
            Connect via the Sticker Galaxy mini-app for real midi rewards.
          </div>
        `
      } else {
        midiEl.innerHTML = `
          <span class="midi-mock">Could Not Record</span>
          <div class="midi-note">${result.error || 'Try Run Again.'}</div>
        `
      }
    }
    return
  }

  const data = result.data

  if (rankEl && data.leaderboard_rank) {
    rankEl.textContent = `Tentative rank: #${data.leaderboard_rank} this month`
  }

  if (!midiEl) return

  if (data.submits_remaining > 0 && data.projected_midi > 0) {
    midiEl.innerHTML = `
      <div class="midi-projected">Bank this run for <strong>+${data.projected_midi}</strong> midi</div>
      <button class="btn btn-primary swamp-btn submit-btn" id="result-submit">
        ✨ Submit Score (${data.submits_remaining} left today)
      </button>
      <div class="midi-note">Or replay to chase a higher score — only banked runs count.</div>
    `
    document.getElementById('result-submit')?.addEventListener('click', async () => {
      const btn = document.getElementById('result-submit') as HTMLButtonElement | null
      if (btn) { btn.disabled = true; btn.textContent = 'Banking…' }
      const submitResp = await sdk.submitResult(data.result_id)
      renderSubmittedState(submitResp)
    })
  } else if (data.submits_remaining <= 0) {
    midiEl.innerHTML = `
      <span class="midi-mock">Daily Cap Reached</span>
      <div class="midi-note">You've used today's submits. Replay all you want — cap resets in 24h.</div>
    `
  } else {
    midiEl.innerHTML = `
      <span class="midi-mock">No Midi (score: 0)</span>
      <div class="midi-note">Pick up some Force essence next run!</div>
    `
  }

  tgHaptic('selection')
  void trophyEl  // trophy fires on submit, not here
}

function renderSubmittedState(resp: sdk.SDKResponse<sdk.SubmitData>): void {
  const midiEl   = document.getElementById('result-midi-val')
  const rankEl   = document.getElementById('result-rank')
  const trophyEl = document.getElementById('result-trophy')

  if (!resp.success) {
    if (midiEl) {
      const err = (resp.error || '').toLowerCase()
      if (err.includes('cap') || err.includes('daily')) {
        midiEl.innerHTML = `<span class="midi-mock">Daily Cap Reached</span><div class="midi-note">${resp.error}</div>`
      } else {
        midiEl.innerHTML = `<span class="midi-mock">Submit Failed</span><div class="midi-note">${resp.error}</div>`
      }
    }
    tgHaptic('warning')
    return
  }

  const data = resp.data
  if (midiEl) {
    midiEl.innerHTML = `<span class="midi-earned">+${data.midi_awarded} midi</span>`
    midiEl.classList.add('animating')
    setTimeout(() => midiEl.classList.remove('animating'), 600)
  }
  if (rankEl && data.leaderboard_rank) {
    rankEl.textContent = `Rank: #${data.leaderboard_rank} this month`
  }
  if (trophyEl && data.trophy_awarded) {
    trophyEl.innerHTML = `🏆 <strong>${data.trophy_awarded.name}</strong>`
    trophyEl.classList.remove('hidden')
    trophyEl.classList.add('visible')
  }
  tgHaptic('success')
}
