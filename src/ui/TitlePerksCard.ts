/**
 * src/ui/TitlePerksCard.ts -- Title screen tier-chrome perks card
 *
 * Shows the player's current tier, perk numbers, and an upgrade CTA.
 * Mounted below the play button on the title screen.
 *
 * CTA states (v0.3.0 -- 4-state wallet-aware):
 *   1. Unbound wallet        -> "Connect wallet" CTA -> promptConnectWallet()
 *   2. Bound + initiate (0)  -> "Buy YODA to unlock perks" -> DEX link
 *   3. Bound + padawan+      -> "Upgrade to {tier} ({req} YODA)" -> DEX link
 *   4. Bound + grandmaster   -> "Max tier" badge (no CTA)
 *
 * API:
 *   mountTitlePerksCard(parentEl) -- append the card to parentEl
 *   refreshTitlePerksCard()       -- re-read tier + wallet from SDK and re-render
 */

import * as sdk from '../sdk.js'
import type { WalletBinding, HolderTier } from '../sdk.js'
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

/**
 * Cached wallet binding. undefined = not yet fetched.
 * null = fetched + confirmed unbound.
 * WalletBinding = fetched + bound.
 */
let _cachedBinding: WalletBinding | null | undefined = undefined

/** Append the perks card to parentEl and render it; async-fetches wallet binding. */
export function mountTitlePerksCard(parentEl: HTMLElement): void {
  _cardEl = document.createElement('div')
  _cardEl.className = 'title-perks-card'
  parentEl.appendChild(_cardEl)

  // Render immediately with loading state for the CTA, then hydrate once binding resolves.
  _renderCard()

  sdk.getWalletBinding().then((binding) => {
    _cachedBinding = binding
    _renderCard()
  }).catch(() => {
    _cachedBinding = null  // treat as unbound on error
    _renderCard()
  })
}

/** Re-render the card; re-fetches wallet binding from SDK. */
export async function refreshTitlePerksCard(): Promise<void> {
  _cachedBinding = await sdk.getWalletBinding().catch(() => null)
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

  const upgradeLine = _buildUpgradeLine(nextInfo)

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

  // Wire the connect-wallet button if present
  _cardEl.querySelector<HTMLButtonElement>('#perks-connect-wallet-btn')?.addEventListener(
    'click',
    _handleConnectWallet
  )
}

/**
 * Build the CTA line based on wallet state + tier.
 *
 * State 0: binding still loading -> show spinner placeholder
 * State 1: unbound               -> "Connect wallet" button
 * State 2: bound + initiate      -> "Buy YODA" DEX link
 * State 3: bound + padawan+      -> "Upgrade" DEX link
 * State 4: bound + grandmaster   -> "Max tier" badge
 */
type NextTierInfo = { nextTier: string; holdReq: string; nextTierKey: HolderTier } | null

function _buildUpgradeLine(nextInfo: NextTierInfo): string {
  // Still loading
  if (_cachedBinding === undefined) {
    return `<div class="title-perks-upgrade-loading">Checking wallet…</div>`
  }

  // -- Unbound: prompt connect regardless of cached tier --
  if (_cachedBinding === null) {
    return `
      <button class="title-perks-upgrade-btn title-perks-connect-btn" id="perks-connect-wallet-btn">
        🔗 Check your tier &mdash; Connect wallet
      </button>
    `
  }

  // -- Bound --
  const binding = _cachedBinding

  if (!nextInfo) {
    // Grandmaster
    return `<div class="title-perks-max">👑 Max tier — thank you</div>`
  }

  if (binding.balance_yoda === 0) {
    // Bound but zero YODA
    return `
      <a class="title-perks-upgrade-btn" href="${YODA_DEX_URL}" target="_blank" rel="noopener noreferrer">
        💎 Buy YODA to unlock perks →
      </a>
    `
  }

  // Padawan or higher -- standard upgrade CTA
  return `
    <a class="title-perks-upgrade-btn" href="${YODA_DEX_URL}" target="_blank" rel="noopener noreferrer">
      ⬆ Upgrade to ${nextInfo.nextTier} (${nextInfo.holdReq} YODA) →
    </a>
  `
}

async function _handleConnectWallet(): Promise<void> {
  if (!_cardEl) return

  // Swap button to loading state
  const btn = _cardEl.querySelector<HTMLButtonElement>('#perks-connect-wallet-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…' }

  const result = await sdk.promptConnectWallet({ reason: 'check_tier' })

  if (result.success) {
    _cachedBinding = await sdk.getWalletBinding().catch(() => null)
  } else {
    // Re-enable the connect button on dismiss / error
    _cachedBinding = null
  }

  _renderCard()
}
