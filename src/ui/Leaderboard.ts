/**
 * src/ui/Leaderboard.ts — optional leaderboard overlay
 *
 * Can be shown mid-game or from the result screen.
 * Polls GET /arcade/v0/leaderboard and renders inline.
 */

import * as sdk from '../sdk.js'
import { type LeaderboardEntry } from '../sdk.js'

let _overlay: HTMLElement | null = null

export async function showLeaderboard(): Promise<void> {
  // Remove any existing overlay
  _overlay?.remove()

  _overlay = document.createElement('div')
  _overlay.className = 'leaderboard-overlay'
  _overlay.innerHTML = `
    <div class="lb-header">
      <span class="leaderboard-title">🏆 Leaderboard</span>
      <button id="lb-close" class="lb-close-btn" aria-label="Close leaderboard">✕</button>
    </div>
    <div class="lb-mando-banner" aria-hidden="true">
      <picture>
        <source srcset="/sprites/v4/yoda_leaderboard_mando.webp" type="image/webp" />
        <img src="/sprites/v4/yoda_leaderboard_mando.gif" alt="Are ya winning son?" />
      </picture>
    </div>
    <div id="lb-body">Loading…</div>
  `
  document.getElementById('app')?.appendChild(_overlay)

  document.getElementById('lb-close')?.addEventListener('click', hideLeaderboard)

  const result = await sdk.getLeaderboard(20, 0)
  const bodyEl = document.getElementById('lb-body')
  if (!bodyEl) return

  if (!result.success) {
    bodyEl.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px;">${result.error}</p>`
    return
  }

  const { entries, month, resets_at } = result.data
  const resetsDate = new Date(resets_at).toLocaleDateString()
  const myId = sdk.getUserId()

  bodyEl.innerHTML = `
    <p style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:12px;">
      ${month} · Resets ${resetsDate}
    </p>
    ${entries.map((e) => renderRow(e, myId)).join('')}
    ${entries.length === 0 ? '<p style="color:var(--text-muted);text-align:center;padding:24px;">No scores yet. Be the first!</p>' : ''}
  `
}

export function hideLeaderboard(): void {
  _overlay?.remove()
  _overlay = null
}

function renderRow(e: LeaderboardEntry, myId: string): string {
  const rankClass =
    e.rank === 1 ? 'gold' :
    e.rank <= 3  ? 'silver' :
    e.rank <= 17 ? 'bronze' : ''

  const isMe = e.user_id === myId

  return `
    <div class="leaderboard-row${isMe ? ' me' : ''}">
      <span class="lb-rank ${rankClass}">#${e.rank}</span>
      <span class="lb-name">${escapeHtml(e.display_name)}${isMe ? ' (you)' : ''}</span>
      <span class="lb-score">${e.score.toLocaleString()}</span>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
