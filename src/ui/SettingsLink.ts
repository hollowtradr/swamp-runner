/**
 * src/ui/SettingsLink.ts -- Settings deep-link footer button
 *
 * Small, low-emphasis footer link that opens the host shell Settings screen
 * at the wallet section. Mounts as a sibling of TitlePerksCard at the bottom
 * of the title screen's .title-content container.
 *
 * When running standalone (window.parent === window), sdk.openSettings() will
 * console.warn -- that is expected behaviour, no visual error is shown.
 */

import * as sdk from '../sdk.js'

let _settingsEl: HTMLElement | null = null

/** Create and append the settings link to parentEl. */
export function mountSettingsLink(parentEl: HTMLElement): void {
  if (_settingsEl) _settingsEl.remove()

  _settingsEl = document.createElement('button')
  _settingsEl.className = 'settings-link'
  _settingsEl.setAttribute('aria-label', 'Open settings')
  _settingsEl.textContent = '\u2699 Settings \u00b7 Wallet'

  _settingsEl.addEventListener('click', () => {
    sdk.openSettings('wallet')
  })

  parentEl.appendChild(_settingsEl)
}
