/**
 * src/ui/TitlePerksCard.ts — Title screen tier-chrome perks card
 *
 * Shows the player's current tier, perk numbers, and an upgrade CTA.
 * Mounted below the play button on the title screen.
 *
 * API:
 *   mountTitlePerksCard(parentEl) — append the card to parentEl
 *   refreshTitlePerksCard()       — re-read tier from SDK and re-render
 */

import * as sdk from '../sdk.js'
import {
  TIER_LABELS,
  TIER_EMOJIS,
  FREE_REVIVES_PER_DAY,
  COSMETIC_DISCOUNT_PCT,
  DAILY_PLAYS,
  NEXT_TIER_INFO,
  YODA_DEX_URL,
} from './tier-perks.js'

let _cardEl: HTMLElement | null = null

/** Append the perks card to parentEl and render it for the current session tier. */
export function mountTitlePerksCard(parentEl: HTMLElement): void {
  _cardEl = document.createElement('div')
  _cardEl.className = 'title-perks-card'
  parentEl.appendChild(_cardEl)
  _renderCard()
}

/** Re-render the card (call after initSession resolves or plays remaining changes). */
export function refreshTitlePerksCard(): void {
  _renderCard()
}

function _renderCard(): void {
  if (!_cardEl) return

  const tier        = sdk.getHolderTier()
  const tierLabel   = TIER_LABELS[tier]
  const tierEmoji   = TIER_EMOJIS[tier]
  const dailyPlays  = DAILY_PLAYS[tier]
  const freeRevives = FREE_REVIVES_PER_DAY[tier]
  const discountPct = COSMETIC_DISCOUNT_PCT[tier]
  const nextInfo    = NEXT_TIER_INFO[tier]

  const upgradeLine = nextInfo
    ? `<a class="title-perks-upgrade-btn" href="${YODA_DEX_URL}" target="_blank" rel="noopener noreferrer">
         Upgrade to ${nextInfo.nextTier} (${nextInfo.holdReq} YODA) →
       </a>`
    : `<div class="title-perks-max">👑 Max tier — thank you</div>`

  // Update modifier class for tier-colored border
  _cardEl.className = `title-perks-card tier-${tier}`

  _cardEl.innerHTML = `
    <div class="title-perks-header">
      <span class="title-perks-tier-label">Your Tier:</span>
      <span class="title-perks-tier-name">${tierEmoji ? `${tierEmoji} ` : ''}${tierLabel}</span>
    </div>
    <div class="title-perks-divider"></div>
    <div class="title-perks-rows">
      <div class="title-perks-row">
        <span class="title-perks-row-label">Daily plays</span>
        <span class="title-perks-row-value">${dailyPlays} / day</span>
      </div>
      <div class="title-perks-row">
        <span class="title-perks-row-label">Free revives</span>
        <span class="title-perks-row-value">${freeRevives} / day</span>
      </div>
      <div class="title-perks-row">
        <span class="title-perks-row-label">Cosmetic discount</span>
        <span class="title-perks-row-value">${discountPct}%</span>
      </div>
    </div>
    ${upgradeLine}
  `
}
