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
  // In-run HUD is intentionally minimal: just the live midi-this-run chip.
  // The holder-tier badge previously rendered here was crowding the canvas
  // Force-Paces parchment + Master-Yoda quote band, and the player already
  // sees their tier on the title screen + result screen. Keep the function
  // signature so callers (initSession, showHUD) stay no-op compatible.
  _el.innerHTML = `
    <div class="hud-midi-badge" id="hud-midi-badge">
      <span class="hud-midi-icon">✨</span>
      <span class="hud-midi-val" id="hud-midi">+0</span>
      <span class="hud-midi-label">this run</span>
    </div>
  `
  _midiEl = document.getElementById('hud-midi')
  // Reference tooltip dict so unused-var lint stays quiet now that the badge
  // is gone but we keep the labels for future re-introduction.
  void TIER_LABELS; void TIER_TOOLTIPS
}

/** Kept as a no-op so external callers (e.g. SDK tier-change events) don't break. */
export function refreshTierBadge(): void {
  // intentionally empty — tier badge no longer rendered during gameplay
  void getHolderTier
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
