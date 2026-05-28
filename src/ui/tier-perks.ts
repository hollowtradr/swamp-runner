/**
 * src/ui/tier-perks.ts — shared tier perk constants + DEX URL
 *
 * Single source of truth for perk tables (mirrors manifest.json yoda_tier_perks).
 * Imported by ResultScreen.ts, TitlePerksCard.ts, and any future component
 * that needs tier data.
 */

import { type HolderTier } from '../sdk.js'

export const YODA_DEX_URL = 'https://app.ston.fi/swap?ft=TON&tt=YODA'

export const TIER_LABELS: Record<HolderTier, string> = {
  initiate:    'Initiate',
  padawan:     'Padawan',
  knight:      'Knight',
  master:      'Master',
  grandmaster: 'Grandmaster',
}

export const TIER_EMOJIS: Record<HolderTier, string> = {
  initiate:    '',
  padawan:     '⚪',
  knight:      '⚔️',
  master:      '🛡️',
  grandmaster: '👑',
}

export const FREE_REVIVES_PER_DAY: Record<HolderTier, number> = {
  initiate: 0, padawan: 0, knight: 1, master: 2, grandmaster: 3,
}

export const COSMETIC_DISCOUNT_PCT: Record<HolderTier, number> = {
  initiate: 0, padawan: 5, knight: 15, master: 20, grandmaster: 25,
}

export const DAILY_PLAYS: Record<HolderTier, number> = {
  initiate: 3, padawan: 4, knight: 5, master: 6, grandmaster: 7,
}

export const NEXT_TIER_INFO: Record<HolderTier, {
  nextTier:    string
  holdReq:     string
  nextTierKey: HolderTier
} | null> = {
  initiate:    { nextTier: 'Padawan',     holdReq: '1k',   nextTierKey: 'padawan'     },
  padawan:     { nextTier: 'Knight',      holdReq: '10k',  nextTierKey: 'knight'      },
  knight:      { nextTier: 'Master',      holdReq: '100k', nextTierKey: 'master'      },
  master:      { nextTier: 'Grandmaster', holdReq: '500k', nextTierKey: 'grandmaster' },
  grandmaster: null,
}
