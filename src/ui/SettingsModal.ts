/**
 * src/ui/SettingsModal.ts — in-game settings overlay
 *
 * Single entry point for player-facing settings on the title screen.
 *
 * Game prefs (local, persist via localStorage):
 *   - Show PB Ghost (default OFF; runs use fresh seeds so ghost rarely matches)
 *
 * Wallet & account (delegated to Sticker Galaxy host shell):
 *   - Wallet & connections → opens host Settings at the wallet section
 *     (where users connect, disconnect, switch wallets, view tier)
 *
 * The wallet itself is shell-owned — TonConnect lives in the top-level
 * Sticker Galaxy frame, not in this game iframe. Bindings persist across
 * the host bot, settings panel, and every game.
 */

import * as sdk from '../sdk.js'

const LS_SHOW_GHOST = 'swamp_runner:show_ghost'

let _overlay: HTMLElement | null = null

export function showSettingsModal(): void {
  _overlay?.remove()

  const showGhost = localStorage.getItem(LS_SHOW_GHOST) === 'true'
  const inShell = typeof window !== 'undefined' && window.parent !== window

  _overlay = document.createElement('div')
  _overlay.className = 'settings-overlay'
  _overlay.innerHTML = `
    <div class="settings-card">
      <div class="settings-header">
        <span class="settings-title">⚙️ Settings</span>
        <button id="settings-close" class="settings-close-btn" aria-label="Close settings">✕</button>
      </div>

      <div class="settings-body">
        <div class="settings-section-label">Game</div>

        <label class="settings-row">
          <div class="settings-row-label">
            <span class="settings-row-title">Show PB Ghost</span>
            <span class="settings-row-sub">Race a cyan silhouette of your best run. Only appears when the random seed happens to match a stored PB — off by default since seeds change each run.</span>
          </div>
          <input type="checkbox" id="setting-ghost" class="settings-toggle" ${showGhost ? 'checked' : ''} />
        </label>

        <div class="settings-section-label">Account</div>

        <button id="setting-wallet" class="settings-row settings-row-button" ${inShell ? '' : 'disabled'}>
          <div class="settings-row-label">
            <span class="settings-row-title">Wallet &amp; connections</span>
            <span class="settings-row-sub">${inShell
              ? 'Connect, disconnect, or switch wallets. Opens the Sticker Galaxy settings panel — your binding is shared across the bot and every game.'
              : 'Available inside Sticker Galaxy / Baby Yoda bot.'}</span>
          </div>
          <span class="settings-row-chevron" aria-hidden="true">→</span>
        </button>
      </div>

      <div class="settings-footer">
        <button id="settings-done" class="btn swamp-play-btn settings-done-btn">Done</button>
      </div>
    </div>
  `

  document.getElementById('app')?.appendChild(_overlay)

  const ghostInput = document.getElementById('setting-ghost') as HTMLInputElement | null
  ghostInput?.addEventListener('change', () => {
    localStorage.setItem(LS_SHOW_GHOST, ghostInput.checked ? 'true' : 'false')
  })

  document.getElementById('setting-wallet')?.addEventListener('click', () => {
    sdk.openSettings('wallet')
    hideSettingsModal()
  })

  document.getElementById('settings-close')?.addEventListener('click', hideSettingsModal)
  document.getElementById('settings-done')?.addEventListener('click', hideSettingsModal)
}

export function hideSettingsModal(): void {
  _overlay?.remove()
  _overlay = null
}
