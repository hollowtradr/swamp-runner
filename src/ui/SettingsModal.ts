/**
 * src/ui/SettingsModal.ts — in-game settings overlay
 *
 * Local-only preferences stored in localStorage. Currently:
 *   - Show PB ghost (default OFF; runs use fresh seeds so ghost rarely matches)
 *
 * Future toggles (haptics, music, contrast) drop in here.
 */

const LS_SHOW_GHOST = 'swamp_runner:show_ghost'

let _overlay: HTMLElement | null = null

export function showSettingsModal(): void {
  _overlay?.remove()

  const showGhost = localStorage.getItem(LS_SHOW_GHOST) === 'true'

  _overlay = document.createElement('div')
  _overlay.className = 'settings-overlay'
  _overlay.innerHTML = `
    <div class="settings-card">
      <div class="settings-header">
        <span class="settings-title">⚙️ Settings</span>
        <button id="settings-close" class="settings-close-btn" aria-label="Close settings">✕</button>
      </div>

      <div class="settings-body">
        <label class="settings-row">
          <div class="settings-row-label">
            <span class="settings-row-title">Show PB Ghost</span>
            <span class="settings-row-sub">Race a cyan silhouette of your best run. Only shows when the random seed happens to match a stored PB — off by default since seeds change each run.</span>
          </div>
          <input type="checkbox" id="setting-ghost" class="settings-toggle" ${showGhost ? 'checked' : ''} />
        </label>
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

  document.getElementById('settings-close')?.addEventListener('click', hideSettingsModal)
  document.getElementById('settings-done')?.addEventListener('click', hideSettingsModal)
}

export function hideSettingsModal(): void {
  _overlay?.remove()
  _overlay = null
}
