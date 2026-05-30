/**
 * src/ui/ResultScreen.ts -- Swamp Runner result screen
 *
 * Flow on game-over:
 *   1. [loss only, first death] Revive offer -- 5s countdown, 3 purchase buttons
 *   2. Final result -- score, midi, rank, submit button
 *      + daily-plays-exhausted card (when daily cap hit)
 *      + cosmetic shelf (always visible after a run)
 *
 * Follows SDK spec: POST /arcade/v0/result -> /arcade/v0/submit.
 *
 * v0.3.0: TON + YODA revive buttons show wallet-required state and gracefully
 * degrade when the player dismisses the wallet modal.
 */

import * as sdk from '../sdk.js'

import { type HolderTier } from '../sdk.js'
import { tgHaptic, tgMainButton } from '../tg.js'
import { getGameOverQuote, reviveGame } from '../game/index.js'
import {
  TIER_LABELS,
  FREE_REVIVES_PER_DAY,
  COSMETIC_DISCOUNT_PCT,
  DAILY_PLAYS,
  NEXT_TIER_INFO,
  YODA_DEX_URL,
} from './tier-perks.js'

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

// Tier perk tables imported from ./tier-perks.ts -- no local duplication

// -- Featured cosmetics (rotating shelf) --------------------------------------

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

// Feature flag: the SDK cosmetic-purchase flow is wired and tested, but we have
// no actual cosmetic skins shipping yet (no asset, no application effect).
// Hide the shelf in production until skins exist. Flip back to true to re-enable
// for SDK regression testing.
const SHOW_COSMETIC_SHELF = false

// -- Free-revive daily counter (localStorage) ----------------------------------

function freeReviveKey(): string {
  return `swamp_runner_free_revives_${new Date().toISOString().slice(0, 10)}`
}

function getFreeRevivesUsedToday(): number {
  return parseInt(localStorage.getItem(freeReviveKey()) ?? '0', 10)
}

function incrementFreeRevivesUsed(): void {
  localStorage.setItem(freeReviveKey(), String(getFreeRevivesUsedToday() + 1))
}

// -- Pending extra-play purchase (single-use, stashed across runs) -------------
//
// When the player buys an extra play, the backend purchase row is created in
// 'paid_pending' status. The next /submit MUST include the purchase id so the
// backend can consume the slot. We persist via localStorage so the purchase
// survives the iframe/page reload between purchase and run-complete.

const PENDING_EXTRA_PLAY_KEY = 'swamp_runner_pending_extra_play'

function stashPendingExtraPlay(purchaseId: string): void {
  try { localStorage.setItem(PENDING_EXTRA_PLAY_KEY, purchaseId) } catch { /* */ }
}

/** Read + clear the pending purchase id. Single-use by design. */
function consumePendingExtraPlay(): string | undefined {
  try {
    const id = localStorage.getItem(PENDING_EXTRA_PLAY_KEY)
    if (id) {
      localStorage.removeItem(PENDING_EXTRA_PLAY_KEY)
      return id
    }
  } catch { /* */ }
  return undefined
}

export function hasPendingExtraPlay(): boolean {
  try { return !!localStorage.getItem(PENDING_EXTRA_PLAY_KEY) } catch { return false }
}

// -- Public entry point -------------------------------------------------------

export function showResultScreen(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
  onPlayAgain: () => void,
  onRevive?: () => void,
): void {
  if (!_el) return
  _el.classList.remove('hidden')

  // Show revive offer ONLY if the player has a free revive available this
  // run (tier-granted, 0/0/1/2/3 per day). Paid revives are intentionally
  // not offered — they'd be P2W on the score axis. Players who want more
  // attempts buy extra PLAYS from the title screen instead, which gives a
  // fresh ranked run rather than extending an existing one. Each player
  // tops out at the same universal daily ceiling (7 plays/game) regardless
  // of wallet depth.
  const tier        = sdk.getHolderTier()
  const freePerDay  = FREE_REVIVES_PER_DAY[tier]
  const freeUsed    = getFreeRevivesUsedToday()
  const eligibleForFreeRevive =
    outcome === 'loss' && !_hasRevived && freePerDay > 0 && freeUsed < freePerDay

  if (eligibleForFreeRevive) {
    void renderReviveOffer(score, outcome, onPlayAgain, onRevive)
  } else {
    renderFinalResult(score, outcome, onPlayAgain)
  }
}

export function hideResultScreen(): void {
  _el?.classList.add('hidden')
}

// -- Revive offer screen -------------------------------------------------------

async function renderReviveOffer(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
  onPlayAgain: () => void,
  onRevive?: () => void,
): Promise<void> {
  /** Apply state-level revive + signal main to resume HUD polling. */
  function doRevive(): void {
    const ok = reviveGame()
    if (ok && onRevive) {
      onRevive()
    } else {
      // Fall back to full restart if state revive failed (state was nulled etc.)
      onPlayAgain()
    }
  }
  if (!_el) return

  const tier          = sdk.getHolderTier()
  const freePerDay    = FREE_REVIVES_PER_DAY[tier]
  const freeUsed      = getFreeRevivesUsedToday()
  const isLowTier     = tier === 'initiate' || tier === 'padawan'

  _el.innerHTML = `
    <div class="result-scroll">
      <div class="result-scroll-inner revive-offer">
        <div class="revive-sticker" aria-hidden="true">
          <picture>
            <source srcset="/sprites/v4/yoda_shocked.webp" type="image/webp" />
            <img src="/sprites/v4/yoda_shocked.gif" alt="" width="96" height="96" />
          </picture>
        </div>
        <div class="revive-title">"Force essence enough, you have. Continue?"</div>

        <div class="revive-countdown-wrap">
          <div class="revive-countdown-bar" id="revive-bar"></div>
        </div>
        <div class="revive-timer-label" id="revive-timer">7</div>

        <div class="revive-buttons">
          <button class="btn btn-success swamp-btn revive-btn revive-btn-free" id="revive-free">
            🎁 Use Free Revive
            <span class="revive-btn-sub">${freePerDay - freeUsed} of ${freePerDay} left today · 1 per run</span>
          </button>
        </div>
        <div class="revive-rule-note">
          One revive per run. ${freePerDay > 1 ? `Your other ${freePerDay - 1} carry over to your next runs today.` : ''}
        </div>

        ${isLowTier ? `
          <div class="revive-upsell">
            Hold 10k YODA (~$37) = 1 free revive/day forever.
          </div>
        ` : ''}

        <button class="btn btn-ghost revive-skip" id="revive-skip">Skip →</button>
      </div>
    </div>
  `

  // 7-second countdown
  let secsLeft = 7
  const timerEl = document.getElementById('revive-timer')
  const barEl   = document.getElementById('revive-bar')
  let autoTimer: ReturnType<typeof setInterval> | null = null

  function startCountdown(): void {
    autoTimer = setInterval(() => {
      secsLeft--
      if (timerEl) timerEl.textContent = String(secsLeft)
      if (barEl)   barEl.style.width   = `${(secsLeft / 7) * 100}%`
      if (secsLeft <= 0) {
        clearInterval(autoTimer!)
        renderFinalResult(score, outcome, onPlayAgain)
      }
    }, 1000)
  }

  function cancelCountdown(): void {
    if (autoTimer) clearInterval(autoTimer)
  }

  function handleFreeRevive(): void {
    cancelCountdown()
    incrementFreeRevivesUsed()
    _hasRevived = true
    hideResultScreen()
    doRevive()  // true in-run revival
  }

  // Bind buttons
  document.getElementById('revive-free')?.addEventListener('click', handleFreeRevive)
  document.getElementById('revive-skip')?.addEventListener('click', () => {
    cancelCountdown()
    renderFinalResult(score, outcome, onPlayAgain)
  })

  startCountdown()
  // Haptic pulse so the player notices the offer on arrival
  tgHaptic('warning')
}

// -- Final result screen -------------------------------------------------------

function renderFinalResult(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
  onPlayAgain: () => void,
): void {
  if (!_el) return

  const quote    = getGameOverQuote()
  const isWin    = outcome === 'win'
  const tier     = sdk.getHolderTier()
  const playsRem = sdk.getDailyPlaysRemaining()

  // Animated Egor stickers for result screens. Victory = party-porgs sticker,
  // Defeat = pensive sticker. Both decoded from the official BabyYoda TGS pack
  // and rendered to webp (with gif fallback) so the <img> tag plays them
  // natively without a Lottie runtime.
  const spriteEl = isWin
    ? `<picture>
         <source srcset="/sprites/v4/yoda_victory_party.webp" type="image/webp" />
         <img src="/sprites/v4/yoda_victory_party.gif" class="result-sprite" alt="Victory!" />
       </picture>`
    : `<picture>
         <source srcset="/sprites/v4/yoda_defeat_v4.webp" type="image/webp" />
         <img src="/sprites/v4/yoda_defeat_v4.gif" class="result-sprite result-sprite-defeat" alt="Defeat" />
       </picture>`

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
          ${sdk.getPaidPlaysRemaining() > 0 ? renderExtraPlayPill(sdk.getPaidPlaysRemaining()) : ''}
        </div>

        ${SHOW_COSMETIC_SHELF ? renderCosmeticShelf(tier) : ''}

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
          <button class="btn btn-ghost swamp-btn-ghost" id="result-ghost-toggle" style="margin-top:4px;font-size:12px;opacity:0.75;">
            👻 Show ghost run: ON
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

  // Ghost toggle — persists in localStorage
  const GHOST_PREF_KEY = 'swamp_runner:show_ghost'
  let ghostOn = localStorage.getItem(GHOST_PREF_KEY) !== 'false'
  const ghostBtn = document.getElementById('result-ghost-toggle')
  if (ghostBtn) {
    ghostBtn.textContent = `👻 Show ghost run: ${ghostOn ? 'ON' : 'OFF'}`
    ghostBtn.addEventListener('click', () => {
      ghostOn = !ghostOn
      localStorage.setItem(GHOST_PREF_KEY, String(ghostOn))
      ghostBtn.textContent = `👻 Show ghost run: ${ghostOn ? 'ON' : 'OFF'}`
    })
  }

  // Extra-play purchase pill
  // Charter §4 alignment: buying an extra play grants ONE additional fresh
  // ranked attempt today, capped at the universal 7/game/day ceiling. The
  // purchased play is consumed when the next /submit lands.
  document.getElementById('extra-play-purchase')?.addEventListener('click', async () => {
    const btn = document.getElementById('extra-play-purchase') as HTMLButtonElement | null
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…' }
    const resp = await sdk.requestPurchase(
      'extra_play',
      'extra_play',
      // backend wants nanoton for TON (1 TON = 1e9). 0.3 TON = 3e8.
      300_000_000,
      'Extra play',
      'TON',
    )
    if (resp.success && resp.data?.purchase_id) {
      stashPendingExtraPlay(resp.data.purchase_id)
      // Locally reflect the cap consumption so the user can't double-buy past
      // their ceiling within the same result screen. Backend is the source of
      // truth on next /session refresh.
      sdk.decrementPaidPlaysRemaining(1)
      if (btn) {
        btn.disabled = true
        btn.innerHTML = `<picture style="display:inline-block;vertical-align:middle;margin-right:6px;"><source srcset="/sprites/v4/yoda_coffee.webp" type="image/webp" /><img src="/sprites/v4/yoda_coffee.gif" alt="" width="32" height="32" /></picture> Extra play purchased — Run Again!`
        btn.classList.add('btn-success')
      }
    } else {
      if (btn) {
        btn.disabled = false
        btn.textContent = '⚡ Buy extra play · 0.3 TON'
      }
    }
  })

  // YODA extra-play purchase pill
  document.getElementById('extra-play-purchase-yoda')?.addEventListener('click', async () => {
    const btn = document.getElementById('extra-play-purchase-yoda') as HTMLButtonElement | null
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…' }
    const resp = await sdk.requestPurchase(
      'extra_play',
      'extra_play',
      // 50 YODA × 1e9 nano-units (YODA has 9 decimals)
      50_000_000_000,
      'Extra play (burned)',
      'YODA',
    )
    if (resp.success && resp.data?.purchase_id) {
      stashPendingExtraPlay(resp.data.purchase_id)
      sdk.decrementPaidPlaysRemaining(1)
      if (btn) {
        btn.disabled = true
        btn.innerHTML = `<picture style="display:inline-block;vertical-align:middle;margin-right:6px;"><source srcset="/sprites/v4/yoda_coffee.webp" type="image/webp" /><img src="/sprites/v4/yoda_coffee.gif" alt="" width="32" height="32" /></picture> 50 $YODA burned — Run Again!`
        btn.classList.add('btn-success')
      }
    } else {
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Pay 50 $YODA — burned forever 🔥'
      }
    }
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

// -- Extra-play purchase pill (shown on every final result screen) ------------

function renderExtraPlayPill(paidLeft: number): string {
  // Universal ceiling: every tier maxes at 7 plays/day. Free plays are
  // tier-granted (Initiate 3 → Grandmaster 7). Paid extra plays let lower
  // tiers buy up to the 7 ceiling, capped at (7 − free_cap). Grandmaster
  // gets all 7 free and cannot buy any — the pill is hidden for them
  // because paidLeft == 0.
  return `
    <div class="extra-play-pill" id="extra-play-pill">
      <button class="btn btn-ghost extra-play-btn" id="extra-play-purchase">
        ⚡ Buy extra play · 0.3 TON
        <span class="extra-play-sub">${paidLeft} of your daily ceiling left to buy</span>
      </button>
      <button class="btn btn-secondary extra-play-btn" id="extra-play-purchase-yoda" style="margin-top:8px;">
        <picture style="display:inline-block;vertical-align:middle;margin-right:6px;"><source srcset="/sprites/v4/yoda_coffee.webp" type="image/webp" /><img src="/sprites/v4/yoda_coffee.gif" alt="" width="24" height="24" /></picture>
        Pay 50 $YODA — burned forever 🔥
        <span class="extra-play-sub">${paidLeft} of your daily ceiling left to buy</span>
      </button>
    </div>
  `
}

// -- Daily-plays-exhausted card -----------------------------------------------

function renderDailyPlaysCard(tier: HolderTier): string {
  const playsNow  = DAILY_PLAYS[tier]
  const nextInfo  = NEXT_TIER_INFO[tier]
  const tierLabel = TIER_LABELS[tier]

  const upgradeHint = nextInfo
    ? `<div class="daily-plays-upgrade">
        ${tierLabel}: ${playsNow}/day → Hold ${nextInfo.holdReq} YODA → ${nextInfo.nextTier}: ${DAILY_PLAYS[nextInfo.nextTierKey]}/day
       </div>
       <a class="btn btn-ghost swamp-btn-ghost daily-plays-cta"
          href="${YODA_DEX_URL}"
          target="_blank" rel="noopener noreferrer">
         Get YODA ↗
       </a>`
    : `<div class="daily-plays-upgrade">You're already at Grandmaster — max plays unlocked!</div>`

  return `
    <div class="daily-plays-card">
      <div class="daily-plays-sleeping" aria-hidden="true">
        <picture>
          <source srcset="/sprites/v4/yoda_sleeping.webp" type="image/webp" />
          <img src="/sprites/v4/yoda_sleeping.gif" alt="" />
        </picture>
      </div>
      <div class="daily-plays-title">Daily plays exhausted (${playsNow}/${playsNow})</div>
      ${upgradeHint}
    </div>
  `
}

// -- Cosmetic shelf -----------------------------------------------------------

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

// -- Internal: post game result -----------------------------------------------

async function postGameResult(
  score: number,
  outcome: 'win' | 'loss' | 'draw',
): Promise<void> {
  const durationSecs = Math.round((performance.now() - _startTime) / 1000)

  /**
   * REAL SDK CALL -- shape:
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
      pickups_collected: 0,   // TODO: thread from state -- phase 2
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
      const extraPlayPurchaseId = consumePendingExtraPlay()
      const submitResp = await sdk.submitResult(data.result_id, { extraPlayPurchaseId })
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
    midiEl.innerHTML = `
      <picture class="submit-sticker" aria-hidden="true">
        <source srcset="/sprites/v4/yoda_thumbsup.webp" type="image/webp" />
        <img src="/sprites/v4/yoda_thumbsup.gif" alt="" width="80" height="80" />
      </picture>
      <span class="midi-earned">+${data.midi_awarded} midi</span>`
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
