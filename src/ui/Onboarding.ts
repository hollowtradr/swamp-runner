/**
 * src/ui/Onboarding.ts — First-run onboarding modal
 *
 * Two-screen modal shown once on first launch:
 *   Screen 1: How midi works
 *   Screen 2: $YODA holder perks (condensed tier table)
 *
 * Sets localStorage['swamp_runner_onboarded'] = '1' on dismiss.
 * Subsequent visits skip it entirely.
 */

const STORAGE_KEY = 'swamp_runner_onboarded'

// ── Tier table data (matches manifest.json yoda_tier_perks) ──────────────────

interface TierRow {
  label: string
  playsPerDay: number
  freeRevives: number
}

const TIER_ROWS: TierRow[] = [
  { label: 'Initiate',        playsPerDay: 3, freeRevives: 0 },
  { label: 'Padawan ⚪',      playsPerDay: 4, freeRevives: 0 },
  { label: 'Knight ⚔️',      playsPerDay: 5, freeRevives: 1 },
  { label: 'Master 🛡️',      playsPerDay: 6, freeRevives: 2 },
  { label: 'Grandmaster 👑',  playsPerDay: 7, freeRevives: 3 },
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Show the onboarding modal if this is the player's first session.
 * Safe to call on every startup — silently no-ops after first dismissal.
 */
export function maybeShowOnboarding(): void {
  if (localStorage.getItem(STORAGE_KEY) !== null) return

  const overlay = buildOverlay()
  document.body.appendChild(overlay)
  showScreen(overlay, 1)
}

// ── Builder ───────────────────────────────────────────────────────────────────

function buildOverlay(): HTMLElement {
  const overlay = document.createElement('div')
  overlay.id = 'onboarding-overlay'
  overlay.className = 'onboarding-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Welcome to Swamp Runner')

  overlay.innerHTML = `
    <div class="onboarding-modal">

      <!-- Screen 1: How midi works -->
      <div class="onboarding-screen" id="onboard-screen-1">
        <div class="onboarding-title">⚡ How Midi Works</div>
        <ul class="onboarding-bullets">
          <li>🌿 <strong>Earn midi from every run</strong> — farther you go, more you earn.</li>
          <li>✨ <strong>Spend midi on extras</strong> — revives, cosmetics, and more.</li>
          <li>🚫 <strong>Midi never converts to USD</strong> — it's arcade credits, not cash.</li>
        </ul>
        <div class="onboarding-actions">
          <button class="btn btn-primary swamp-btn" id="onboard-next">
            Next → $YODA Perks
          </button>
        </div>
        <div class="onboarding-progress">1 / 2</div>
      </div>

      <!-- Screen 2: $YODA holder perks -->
      <div class="onboarding-screen hidden" id="onboard-screen-2">
        <div class="onboarding-title">💎 $YODA Holder Perks</div>
        <p class="onboarding-sub">Hold $YODA to unlock more plays and free revives every day.</p>
        <table class="onboarding-tier-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Plays / Day</th>
              <th>Free Revives</th>
            </tr>
          </thead>
          <tbody>
            ${TIER_ROWS.map((r) => `
              <tr>
                <td>${r.label}</td>
                <td>${r.playsPerDay}</td>
                <td>${r.freeRevives}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="onboarding-actions">
          <button class="btn btn-primary swamp-btn" id="onboard-done">
            Let's Run! 🌿
          </button>
        </div>
        <div class="onboarding-progress">2 / 2</div>
      </div>

    </div>
  `

  return overlay
}

// ── Screen management ─────────────────────────────────────────────────────────

function showScreen(overlay: HTMLElement, screen: 1 | 2): void {
  overlay.querySelector<HTMLElement>('#onboard-screen-1')?.classList.toggle('hidden', screen !== 1)
  overlay.querySelector<HTMLElement>('#onboard-screen-2')?.classList.toggle('hidden', screen !== 2)

  if (screen === 1) {
    overlay.querySelector('#onboard-next')?.addEventListener('click', () => {
      showScreen(overlay, 2)
    })
  } else {
    overlay.querySelector('#onboard-done')?.addEventListener('click', () => {
      dismiss(overlay)
    })
  }
}

function dismiss(overlay: HTMLElement): void {
  localStorage.setItem(STORAGE_KEY, '1')
  overlay.classList.add('onboarding-exit')
  // Remove from DOM after animation completes
  setTimeout(() => overlay.remove(), 350)
}
