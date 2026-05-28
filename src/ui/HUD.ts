/**
 * src/ui/HUD.ts — Swamp Runner HUD overlay
 *
 * Minimal DOM HUD (the canvas renders the parchment score box inline).
 * This overlay handles the midi balance badge + tier badge top-right.
 * Score is drawn on canvas.
 */

import { type GameState } from '../game/state.js'
import { getHolderTier, type HolderTier } from '../sdk.js'

let _el: HTMLElement | null = null
let _midiEl: HTMLElement | null = null

// Game's declared max_score in our backend manifest (used to project midi this run).
// Backend mints midi via: round(score / max_score * 1000), capped at 1000/play.
const MAX_SCORE = 99_999
const MIDI_CAP_PER_PLAY = 1_000

// ── Tier display config ────────────────────────────────────────────────────────

const TIER_LABELS: Record<HolderTier, string> = {
  initiate:    'Initiate',
  padawan:     'Padawan ⚪',
  knight:      'Knight ⚔️',
  master:      'Master 🛡️',
  grandmaster: 'Grandmaster 👑',
}

const TIER_TOOLTIPS: Record<HolderTier, string> = {
  initiate:    'Hold $YODA for perks. Knight tier = 1 free revive/day + 5 plays/day + 15% off cosmetics.',
  padawan:     'Padawan perks: 4 plays/day + 5% cosmetic discount. Upgrade to Knight for 1 free revive/day.',
  knight:      'Knight perks: 5 plays/day + 1 free revive/day + 15% off cosmetics.',
  master:      'Master perks: 6 plays/day + 2 free revives/day + 20% off cosmetics.',
  grandmaster: 'Grandmaster perks: 7 plays/day + 3 free revives/day + 25% off cosmetics + 40% trophy bonus.',
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initHUD(): void {
  _el = document.getElementById('hud')!
  _el.innerHTML = `
    <div class="hud-midi-badge" id="hud-midi-badge">
      <span class="hud-midi-icon">✨</span>
      <span class="hud-midi-val" id="hud-midi">+0</span>
      <span class="hud-midi-label">this run</span>
    </div>
    <div class="hud-tier-badge" id="hud-tier-badge" role="button" tabindex="0" aria-label="Holder tier info">
      <span class="hud-tier-label" id="hud-tier-label">Initiate</span>
    </div>
    <div class="hud-tier-tooltip hidden" id="hud-tier-tooltip" role="tooltip"></div>
  `
  _midiEl = document.getElementById('hud-midi')

  const tierBadge = document.getElementById('hud-tier-badge')
  const tierTip   = document.getElementById('hud-tier-tooltip')

  // Tap/click → toggle tooltip
  tierBadge?.addEventListener('click', (e) => {
    e.stopPropagation()
    tierTip?.classList.toggle('hidden')
  })
  tierBadge?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') tierTip?.classList.toggle('hidden')
  })

  // Dismiss tooltip when clicking elsewhere
  document.addEventListener('click', () => {
    tierTip?.classList.add('hidden')
  })

  refreshTierBadge()
}

/** Call after initSession resolves so the badge reflects the actual tier. */
export function refreshTierBadge(): void {
  const tier    = getHolderTier()
  const labelEl = document.getElementById('hud-tier-label')
  const tipEl   = document.getElementById('hud-tier-tooltip')
  if (labelEl) labelEl.textContent = TIER_LABELS[tier]
  if (tipEl)   tipEl.textContent   = TIER_TOOLTIPS[tier]
}

// ── Visibility ────────────────────────────────────────────────────────────────

export function showHUD(): void {
  _el?.classList.remove('hidden')
  refreshTierBadge()
}

export function hideHUD(): void {
  _el?.classList.add('hidden')
}

// ── Per-frame update ──────────────────────────────────────────────────────────

export function updateHUD(state: GameState | null, _midiBalance: number | null): void {
  if (!_midiEl) return
  if (!state) {
    _midiEl.textContent = '+0'
    return
  }
  // Projected midi for current score (matches backend mint formula).
  // Capped at MIDI_CAP_PER_PLAY (1000) per spec §5.
  const projected = Math.min(
    Math.floor((state.score / MAX_SCORE) * MIDI_CAP_PER_PLAY),
    MIDI_CAP_PER_PLAY,
  )
  _midiEl.textContent = `+${projected}`
}
