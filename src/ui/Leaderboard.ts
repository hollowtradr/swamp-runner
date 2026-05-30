/**
 * src/ui/Leaderboard.ts — monthly leaderboard overlay
 *
 * SOTA presentation:
 *   - Parchment-scroll surface (matches Result Screen aesthetic).
 *   - Podium for top 3 (medal + name + score, height-ranked).
 *   - Trophy tier chips beside each row (not color-only; works for
 *     red-green color vision).
 *   - "You" row pinned at bottom if outside the visible top 20.
 *   - Month + reset date as a small header strip.
 */

import * as sdk from '../sdk.js'
import { type LeaderboardEntry } from '../sdk.js'

let _overlay: HTMLElement | null = null

export async function showLeaderboard(): Promise<void> {
  _overlay?.remove()

  _overlay = document.createElement('div')
  _overlay.className = 'leaderboard-overlay'
  _overlay.innerHTML = `
    <div class="lb-scroll">
      <div class="lb-parchment">
        <div class="lb-header">
          <div class="lb-title-block">
            <div class="lb-eyebrow">Sticker Galaxy Arcade</div>
            <h2 class="lb-title">Monthly Leaderboard</h2>
          </div>
          <button id="lb-close" class="lb-close-btn" aria-label="Close leaderboard">✕</button>
        </div>

        <div id="lb-body" class="lb-body">
          <div class="lb-loading">Tallying the swamp…</div>
        </div>
      </div>
    </div>
  `
  document.getElementById('app')?.appendChild(_overlay)

  document.getElementById('lb-close')?.addEventListener('click', hideLeaderboard)
  _overlay.addEventListener('click', (e) => {
    if (e.target === _overlay) hideLeaderboard()
  })

  const result = await sdk.getLeaderboard(20, 0)
  const bodyEl = document.getElementById('lb-body')
  if (!bodyEl) return

  if (!result.success) {
    bodyEl.innerHTML = `<p class="lb-empty">${escapeHtml(result.error)}</p>`
    return
  }

  const { entries, month, resets_at } = result.data
  const resetsDate = new Date(resets_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  })
  const myId = sdk.getUserId()

  if (entries.length === 0) {
    bodyEl.innerHTML = `
      <div class="lb-meta">${formatMonth(month)} · Resets ${resetsDate}</div>
      <p class="lb-empty">No scores banked yet this month. Be the first.</p>
    `
    return
  }

  const top3 = entries.slice(0, 3)
  const rest = entries.slice(3)
  const myEntry = entries.find((e) => e.user_id === myId)
  const myRankInList = myEntry?.rank ?? null
  const showPinnedMe = myEntry && myRankInList && myRankInList > 20

  bodyEl.innerHTML = `
    <div class="lb-meta">${formatMonth(month)} · Resets ${resetsDate}</div>

    ${top3.length > 0 ? renderPodium(top3, myId) : ''}

    ${rest.length > 0 ? `
      <div class="lb-list">
        ${rest.map((e) => renderRow(e, myId)).join('')}
      </div>
    ` : ''}

    ${showPinnedMe && myEntry ? `
      <div class="lb-pinned-label">Your standing</div>
      <div class="lb-list">${renderRow(myEntry, myId)}</div>
    ` : ''}
  `
}

export function hideLeaderboard(): void {
  _overlay?.remove()
  _overlay = null
}

// ── Renderers ────────────────────────────────────────────────────────────────

function renderPodium(top3: LeaderboardEntry[], myId: string): string {
  // Visual order: 2nd, 1st (center, taller), 3rd. Hide slots that don't exist.
  const e1 = top3.find((e) => e.rank === 1)
  const e2 = top3.find((e) => e.rank === 2)
  const e3 = top3.find((e) => e.rank === 3)
  const cell = (e: LeaderboardEntry | undefined, place: 1 | 2 | 3): string => {
    if (!e) return `<div class="lb-podium-cell lb-podium-empty lb-podium-${place}"></div>`
    const isMe = e.user_id === myId
    const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'
    return `
      <div class="lb-podium-cell lb-podium-${place}${isMe ? ' me' : ''}">
        <div class="lb-podium-medal">${medal}</div>
        <div class="lb-podium-name" title="${escapeHtml(e.display_name)}">
          ${escapeHtml(e.display_name)}${isMe ? ' <span class="lb-you">(you)</span>' : ''}
        </div>
        <div class="lb-podium-score">${e.score.toLocaleString()}</div>
        ${e.daily_midi_bonus > 0 ? `
          <div class="lb-podium-bonus" title="Daily midi bonus while you hold this rank">
            +${e.daily_midi_bonus}/day
          </div>` : ''}
      </div>
    `
  }
  return `
    <div class="lb-podium" role="list">
      ${cell(e2, 2)}
      ${cell(e1, 1)}
      ${cell(e3, 3)}
    </div>
  `
}

function renderRow(e: LeaderboardEntry, myId: string): string {
  const isMe = e.user_id === myId
  const tierChip = e.trophy_tier
    ? `<span class="lb-tier-chip lb-tier-${e.trophy_tier}" title="${labelForTier(e.trophy_tier)} tier reward">
         ${glyphForTier(e.trophy_tier)}
       </span>`
    : ''
  const bonus = e.daily_midi_bonus > 0
    ? `<span class="lb-bonus" title="Daily midi bonus while you hold this rank">+${e.daily_midi_bonus}/day</span>`
    : ''
  return `
    <div class="lb-row${isMe ? ' me' : ''}">
      <span class="lb-rank">#${e.rank}</span>
      ${tierChip}
      <span class="lb-name">${escapeHtml(e.display_name)}${isMe ? ' <span class="lb-you">(you)</span>' : ''}</span>
      ${bonus}
      <span class="lb-score">${e.score.toLocaleString()}</span>
    </div>
  `
}

function glyphForTier(tier: string): string {
  // Glyphs carry meaning without relying on color (a11y).
  switch (tier) {
    case 'gold':   return '★'
    case 'silver': return '◆'
    case 'bronze': return '●'
    default:       return ''
  }
}

function labelForTier(tier: string): string {
  if (!tier) return ''
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

function formatMonth(month: string): string {
  // month is "YYYY-MM"
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  const date = new Date(Date.UTC(y, m - 1, 1))
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
