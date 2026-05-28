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

  // Auto-refresh when the shell broadcasts a tier change (e.g. after the user
  // approves in Tonkeeper and the wallet redirect lands back in the mini-app).
  // onTierChange already maintains the SDK's cached binding; we just re-fetch
  // to get the full record (balance_yoda, proof status, etc.).
  sdk.onTierChange(() => {
    // Tonkeeper round-trip suspended the iframe — any in-flight Promise
    // from _handleConnectWallet died with it. Clear the connecting guard so
    // the next render shows the correct bound/unbound CTA instead of
    // 'Connecting…' forever.
    _connecting = false
    sdk.getWalletBinding()
      .then((binding) => { _cachedBinding = binding; _renderCard() })
      .catch(() => { _renderCard() })
  })

  // Also refresh whenever the page becomes visible again — covers the
  // Tonkeeper round-trip case where the iframe was suspended during approval
  // and the SG_TIER_CHANGED broadcast may have fired before our listener
  // was active.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Same suspend-kills-promise reasoning as onTierChange above. If we
      // came back to a visible page, the connect handler's await is dead.
      _connecting = false
      sdk.getWalletBinding()
        .then((binding) => {
          const wasBound = _cachedBinding != null
          const isBound = binding != null
          if (wasBound !== isBound || binding?.tier !== _cachedBinding?.tier) {
            _cachedBinding = binding
          }
          // Always re-render to clear stuck 'Connecting…' even when binding
          // didn't actually change.
          _renderCard()
        })
        .catch(() => { _renderCard() })
    }
  })
}

/** Re-render the card; re-fetches wallet binding from SDK. */
export async function refreshTitlePerksCard(): Promise<void> {
  _cachedBinding = await sdk.getWalletBinding().catch(() => null)
  _renderCard()
}

function _renderCard(): void {
  if (!_cardEl) return

  // Tier source-of-truth precedence:
  //   1. wallet RPC binding (authoritative, refreshed after bind/disconnect/refresh)
  //   2. session tier from /session (page-load snapshot; only used if binding unknown)
  //   3. 'initiate' default
  // We never let session tier override an explicit null binding — that would
  // lie about a user who just disconnected.
  let tier: HolderTier
  if (_cachedBinding) {
    tier = _cachedBinding.tier
  } else if (_cachedBinding === null) {
    tier = 'initiate'  // explicitly unbound
  } else {
    tier = sdk.getHolderTier()  // still loading (undefined)
  }
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
  // In-flight connect attempt — show a disabled "Connecting…" button regardless
  // of cached binding state. Once promptConnectWallet resolves, the handler
  // clears _connecting and re-renders to the correct bound/unbound CTA.
  if (_connecting) {
    return `
      <button class="title-perks-upgrade-btn title-perks-connect-btn" disabled>
        Connecting…
      </button>
    `
  }

  // Still loading initial binding fetch
  if (_cachedBinding === undefined) {
    return `<div class="title-perks-upgrade-loading">Checking wallet…</div>`
  }

  // Source-of-truth: the wallet RPC binding. Session tier is a snapshot from
  // page-load time and can lie after a disconnect; do not fall back to it.
  if (_cachedBinding === null) {
    return `
      <button class="title-perks-upgrade-btn title-perks-connect-btn" id="perks-connect-wallet-btn">
        🔗 Check your tier &mdash; Connect wallet
      </button>
    `
  }

  // -- Bound --
  // Narrowing: at this point _cachedBinding is non-null (both null and
  // undefined branches returned early above).
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

/** Module-level guard so visibility-change / SG_TIER_CHANGED re-renders
 *  do not flicker the button back to "Connect wallet" while an in-flight
 *  promptConnectWallet is still pending. */
let _connecting = false

async function _handleConnectWallet(): Promise<void> {
  if (!_cardEl) return
  if (_connecting) return  // ignore double-tap
  _connecting = true

  // Swap button to loading state via re-render (single source of truth).
  // _buildUpgradeLine consults _connecting to render "Connecting…".
  _renderCard()

  try {
    const result = await sdk.promptConnectWallet({ reason: 'check_tier' })
    // Always refetch from SDK — do not assume result shape; the shell may
    // have already broadcast SG_TIER_CHANGED with the canonical binding.
    if (result.success) {
      _cachedBinding = await sdk.getWalletBinding().catch(() => _cachedBinding ?? null)
    } else if (result.error === 'shell_required' || result.error === 'wallet_no_tonproof' || result.error === 'malformed_proof_client') {
      // Surface a clear unbound state — do not silently swallow the error.
      _cachedBinding = null
      console.warn('[wallet] connect failed:', result.error, result)
    } else {
      // Dismissed or transient error: keep whatever the SDK now reports.
      _cachedBinding = await sdk.getWalletBinding().catch(() => null)
    }
  } finally {
    _connecting = false
    _renderCard()
  }
}
