/// <reference types="vite/client" />
/**
 * src/sdk.ts -- Sticker Galaxy Arcade SDK v0 wrapper (v0.3.0)
 *
 * Wraps every arcade endpoint with:
 *   - Authorization: Bearer <session_token>  (from URL params)
 *   - X-Game-Id: <game_id>                   (from URL params / env)
 *
 * Every method returns { success: true, data } or { success: false, error }.
 * It NEVER throws to game code.
 *
 * SDK spec: https://docs-site-taupe-pi.vercel.app/sdk/
 *
 * v0.3.0 additions:
 *   getWalletBinding()     -- fetch bound wallet or null
 *   promptConnectWallet()  -- JIT TonConnect modal / mock confirm
 *   refreshTier()          -- force $YODA snapshot refresh
 *   openSettings()         -- postMessage to host shell
 *   onTierChange()         -- subscribe to tier-change events
 *   requestPurchase()      -- now auto-prompts wallet for TON/YODA
 */

import { TonConnectUI } from '@tonconnect/ui'
import type { TonProofItemReplySuccess } from '@tonconnect/ui'

import {
  mockGetWalletBinding,
  mockPromptConnectWallet,
  mockRefreshTier,
  mockBindWallet,
  mockDisconnectWallet,
  mockSetTier,
  mockStaleSnapshot,
  mockUnverifyProof,
} from './mock-host.js'

// -- Config -------------------------------------------------------------------

const API_BASE: string =
  (import.meta.env.VITE_ARCADE_API_URL as string | undefined) ??
  'https://babyyoda-bot.fly.dev'

/**
 * Wallet API base -- wallet endpoints are in preview on babyyoda-bot.
 * Will unify with API_BASE when promoted to the main edge.
 */
const WALLET_API_BASE = 'https://babyyoda-bot.fly.dev/arcade/v0'

// -- URL param helpers --------------------------------------------------------

function getParam(key: string): string {
  const params = new URLSearchParams(window.location.search)
  return params.get(key) ?? ''
}

// -- Module state -------------------------------------------------------------

let _sessionToken: string = ''
let _userId: string = ''
let _gameId: string = ''
let _proofOfPlayToken: string = ''
let _holderTier: HolderTier = 'initiate'
let _dailyPlaysRemaining: number = 3

// -- Wallet state -------------------------------------------------------------

/** Cache of last-known wallet binding. Updated by getWalletBinding() and promptConnectWallet(). */
let _lastBinding: WalletBinding | null = null

/** Registered tier-change callbacks. Fired when refreshTier() returns changed=true. */
let _tierChangeCallbacks: Array<(e: TierChangeEvent) => void> = []

/** TonConnect UI singleton (real mode only). */
let _tcUI: TonConnectUI | null = null

/** Pending force-bind data cached from a 409 conflict response. */
interface PendingForceBind {
  address: string
  ton_proof: TonProofItemReplySuccess['proof']
  network: string
}
let _pendingForceBind: PendingForceBind | null = null

/** Returns true when running without a real session token (dev/mock mode). */
function _isMock(): boolean { return _sessionToken === '' }

// -- Types --------------------------------------------------------------------

export interface SDKResult<T> {
  success: true
  data: T
}
export interface SDKError {
  success: false
  error: string
}
export type SDKResponse<T> = SDKResult<T> | SDKError

// Holder tier levels -- maps to YODA balance thresholds on the platform.
export type HolderTier = 'initiate' | 'padawan' | 'knight' | 'master' | 'grandmaster'

/** Full wallet binding record. Returned by getWalletBinding(). */
export interface WalletBinding {
  address: string
  tier: HolderTier
  balance_yoda: number
  last_snapshot_at: string  // ISO8601
  bind_source: 'bot' | 'mini-app' | 'arcade'
  address_public: boolean
  tonproof_verified: boolean
}

/**
 * Returned by promptConnectWallet().
 * On 409 (wallet already bound elsewhere) existing_binding is set.
 */
export interface ConnectResult {
  success: boolean
  address?: string
  tier?: HolderTier
  error?: string
  /** 409 case -- client must show Keep/Replace UI */
  existing_binding?: { address: string; tier: HolderTier; bind_source: string }
}

/** Fired by onTierChange() callbacks when a wallet refresh detects a tier change. */
export interface TierChangeEvent {
  old_tier: HolderTier
  new_tier: HolderTier
  balance_yoda: number
}

export interface SessionData {
  user_id: string
  display_name: string
  midi_balance: number
  daily_plays_remaining: number
  is_featured_game_today: boolean
  proof_of_play_token: string
  session_expires_at: string
  // TODO: backend must populate holder_tier in session response
  holder_tier?: HolderTier
}

export interface EntryData {
  entry_id: string
  new_midi_balance: number
  message: string
}

export interface ResultPayload {
  score: number
  outcome: 'win' | 'loss' | 'draw'
  play_duration_seconds: number
  metadata?: Record<string, unknown>
}

export interface ResultData {
  result_id: string
  midi_awarded: number          // 0 from /result (v2); set by /submit
  projected_midi: number        // what /submit would mint
  submits_remaining: number     // bankable runs left today
  trophy_awarded: TrophyData | null  // always null from /result; set by /submit
  leaderboard_rank: number | null
  message: string
}

export interface SubmitData {
  result_id: string
  midi_awarded: number
  new_midi_balance: number
  trophy_awarded: TrophyData | null
  leaderboard_rank: number | null
  submits_remaining: number
  message: string
}

export interface TrophyData {
  trophy_id: string
  name: string
  tier: string
  awarded_at: string
  description?: string
}

export interface PurchaseData {
  purchase_id: string
  payment_url: string
  studio_credit_ton: number
  message: string
}

export interface LeaderboardEntry {
  rank: number
  user_id: string
  display_name: string
  score: number
  trophy_tier: string | null
  daily_midi_bonus: number
}

export interface LeaderboardData {
  month: string
  resets_at: string
  entries: LeaderboardEntry[]
}

export interface TrophiesData {
  trophies: TrophyData[]
}

// -- Internal fetch wrapper ---------------------------------------------------

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<SDKResponse<T>> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${_sessionToken}`,
    'X-Game-Id': _gameId,
    ...(options.headers as Record<string, string> ?? {}),
  }

  try {
    const res = await fetch(url, { ...options, headers })
    const json = (await res.json()) as Record<string, unknown>

    if (!res.ok || json.success === false) {
      return {
        success: false,
        error: (json.error as string) ?? `HTTP ${res.status}`,
      }
    }

    return { success: true, data: json as unknown as T }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Network error: ${message}` }
  }
}

// -- Wallet internal helpers --------------------------------------------------

/**
 * Status-aware fetch for wallet endpoints (WALLET_API_BASE).
 * Returns { status, data } so callers can branch on HTTP codes (409, 429, etc.).
 * Throws on network failure.
 */
async function walletFetch<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_sessionToken}`,
      'X-Game-Id': _gameId,
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${WALLET_API_BASE}${path}`, init)
  const data = (await res.json()) as T
  return { status: res.status, data }
}

/** Lazy-init TonConnect UI singleton (real mode only). */
function getTonConnect(): TonConnectUI {
  if (!_tcUI) {
    _tcUI = new TonConnectUI({
      manifestUrl: 'https://stickergalaxy.io/tonconnect-manifest.json',
    })
  }
  return _tcUI
}

// -- Public API ---------------------------------------------------------------

/**
 * Bootstrap the SDK from URL params.
 * Call this once before any other SDK method.
 */
export function initSDK(): void {
  _sessionToken =
    getParam('session_token') ||
    (import.meta.env.VITE_ARCADE_SESSION_TOKEN as string | undefined) ||
    ''
  _userId = getParam('user_id') || ''
  _gameId =
    getParam('game_id') ||
    (import.meta.env.VITE_ARCADE_GAME_ID as string | undefined) ||
    'swamp_runner'

  // Expose wallet mock helpers in dev when running without session token
  if (import.meta.env.DEV) {
    window.__mockBindWallet = mockBindWallet
    window.__mockDisconnect = mockDisconnectWallet
    window.__mockSetTier = mockSetTier
    window.__mockStaleSnapshot = mockStaleSnapshot
    window.__mockUnverifyProof = mockUnverifyProof
    if (!_sessionToken) {
      console.info(
        '%c[MOCK WALLET ACTIVE]%c No session token -- wallet calls use localStorage mock.\n' +
        'Dev helpers:\n' +
        '  window.__mockBindWallet(addr?, tier?)  -- bind a mock wallet\n' +
        '  window.__mockDisconnect()              -- reset to unbound\n' +
        '  window.__mockSetTier(tier)             -- change tier\n' +
        '  window.__mockStaleSnapshot()           -- age snapshot 48h\n' +
        '  window.__mockUnverifyProof()           -- set tonproof_verified=false',
        'background:#2563eb;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;',
        ''
      )
    }
  }
}

/** Validate session token and fetch player context. Caches proof_of_play_token. */
export async function initSession(): Promise<SDKResponse<SessionData>> {
  if (!_sessionToken) {
    return {
      success: false,
      error: 'No session_token found. Launch this game from @stickergalaxybot or add ?session_token=... for local dev.',
    }
  }

  const result = await apiFetch<SessionData>('/arcade/v0/session')
  if (result.success) {
    _proofOfPlayToken = result.data.proof_of_play_token
    _userId = _userId || result.data.user_id
    // TODO: backend must populate holder_tier in session response
    _holderTier = result.data.holder_tier ?? 'initiate'
    _dailyPlaysRemaining = result.data.daily_plays_remaining
  }
  return result
}

/**
 * Deduct a midi entry fee to start a play session.
 * Pass entryFeeMidi = 0 for free-to-play games.
 */
export async function postEntry(
  entryFeeMidi: number,
  description?: string,
): Promise<SDKResponse<EntryData>> {
  return apiFetch<EntryData>('/arcade/v0/entry', {
    method: 'POST',
    body: JSON.stringify({
      user_id: _userId,
      entry_fee_midi: entryFeeMidi,
      description: description ?? 'Game entry',
    }),
  })
}

/**
 * Submit the outcome of a completed play session.
 * Must be called with an entry_id from postEntry.
 */
export async function postResult(
  entryId: string,
  payload: ResultPayload,
): Promise<SDKResponse<ResultData>> {
  return apiFetch<ResultData>('/arcade/v0/result', {
    method: 'POST',
    body: JSON.stringify({
      entry_id: entryId,
      user_id: _userId,
      score: payload.score,
      outcome: payload.outcome,
      proof_of_play_token: _proofOfPlayToken,
      play_duration_seconds: payload.play_duration_seconds,
      metadata: payload.metadata ?? {},
    }),
  })
}

/**
 * Bank a practice result -- mints midi, counts toward daily cap, awards trophies
 * if rank qualifies, posts to public leaderboard.
 *
 * Call this only when the player explicitly chooses to submit a run (e.g. taps
 * a 'Submit Score' button). Idempotent: 409 if already submitted.
 */
export async function submitResult(
  resultId: string,
): Promise<SDKResponse<SubmitData>> {
  return apiFetch<SubmitData>('/arcade/v0/submit', {
    method: 'POST',
    body: JSON.stringify({ result_id: resultId }),
  })
}

/**
 * Route a real-money purchase through the host's payment infrastructure.
 * item_type: 'cosmetic_skin' | 'extra_play' | 'tournament_entry'
 * currency:  'TON' | 'Stars' | 'YODA'
 */
export async function purchase(
  itemType: 'cosmetic_skin' | 'extra_play' | 'tournament_entry',
  itemId: string,
  price: number,
  currency: 'TON' | 'Stars' | 'YODA',
  description: string,
): Promise<SDKResponse<PurchaseData>> {
  return apiFetch<PurchaseData>('/arcade/v0/purchase', {
    method: 'POST',
    body: JSON.stringify({
      user_id: _userId,
      item_type: itemType,
      item_id: itemId,
      price,
      currency,
      description,
    }),
  })
}

/** Fetch the current month's leaderboard for this game. */
export async function getLeaderboard(
  limit = 20,
  offset = 0,
): Promise<SDKResponse<LeaderboardData>> {
  return apiFetch<LeaderboardData>(
    `/arcade/v0/leaderboard?game_id=${encodeURIComponent(_gameId)}&limit=${limit}&offset=${offset}`,
  )
}

/** Fetch the current player's trophy collection for this game. */
export async function getTrophies(): Promise<SDKResponse<TrophiesData>> {
  return apiFetch<TrophiesData>(
    `/arcade/v0/trophies?user_id=${encodeURIComponent(_userId)}&game_id=${encodeURIComponent(_gameId)}`,
  )
}

// -- postMessage bridge -------------------------------------------------------

type HostMessageType =
  | 'SESSION_INIT'
  | 'PURCHASE_CONFIRMED'
  | 'PURCHASE_FAILED'
  | 'SESSION_EXPIRING'
  | 'SESSION_KILLED'

type HostMessageHandler = (data: Record<string, unknown>) => void

const _listeners: Partial<Record<HostMessageType, HostMessageHandler>> = {}

/** Register a listener for host->game postMessage events. */
export function onHostMessage(
  type: HostMessageType,
  handler: HostMessageHandler,
): void {
  _listeners[type] = handler
}

/** Send a game->host postMessage. */
export function postMessageBridge(
  type: string,
  extra: Record<string, unknown> = {},
): void {
  window.parent.postMessage({ type, game_id: _gameId, ...extra }, '*')
}

// Bootstrap the message listener once
window.addEventListener('message', (event: MessageEvent) => {
  // In production, restrict to: if (event.origin !== 'https://app.stickergalaxy.io') return
  const data = event.data as Record<string, unknown>
  if (typeof data?.type !== 'string') return
  const handler = _listeners[data.type as HostMessageType]
  handler?.(data)
})

/**
 * requestPurchase(itemType, itemId, price, description, currency)
 *
 * Route a real-money purchase. For TON and YODA purchases, automatically
 * prompts wallet connect if the player is unbound (JIT wallet-connect).
 * Stars is Telegram-native -- NEVER gated by wallet.
 *
 * Returns { success: false, error: 'wallet_required' } when the user
 * dismisses the wallet modal -- callers should gracefully degrade.
 */
export async function requestPurchase(
  itemType: 'cosmetic_skin' | 'extra_play' | 'tournament_entry',
  itemId: string,
  price: number,
  description: string,
  currency: 'TON' | 'Stars' | 'YODA',
): Promise<SDKResponse<PurchaseData>> {
  // JIT wallet check -- TON and YODA require a bound wallet.
  // Stars is Telegram-native and walletless; never gate the Stars path.
  if (currency === 'TON' || currency === 'YODA') {
    const binding = await getWalletBinding()
    if (!binding) {
      const connectResult = await promptConnectWallet({ reason: 'purchase' })
      if (!connectResult.success) {
        return { success: false, error: 'wallet_required' }
      }
    }
  }
  return purchase(itemType, itemId, price, currency, description)
}

// -- Wallet SDK functions (v0.3.0) --------------------------------------------

/**
 * getWalletBinding()
 *
 * Returns the player's current wallet binding or null if unbound.
 * In mock mode (no session token), reads from localStorage.
 * In real mode, hits /arcade/v0/wallet and caches the result.
 * Triggers a background refreshTier() when the snapshot is >24h old.
 */
export async function getWalletBinding(): Promise<WalletBinding | null> {
  if (_isMock()) return mockGetWalletBinding()

  try {
    const { status, data } = await walletFetch<{ address: string | null } & Partial<WalletBinding>>(
      'GET',
      '/wallet'
    )
    if (status === 401) return null
    if (status !== 200 || !data.address) {
      _lastBinding = null
      return null
    }
    _lastBinding = data as WalletBinding
    // Stale snapshot: background refresh (fire-and-forget)
    const ageMs = Date.now() - new Date(data.last_snapshot_at!).getTime()
    if (ageMs > 24 * 60 * 60 * 1000) {
      void refreshTier().catch(() => {})
    }
    return _lastBinding
  } catch {
    return null
  }
}

/**
 * promptConnectWallet(opts?)
 *
 * Opens the TonConnect wallet modal (real) or a confirm() dialog (mock) so
 * the player can connect and bind their TON wallet.
 *
 * On 409 (existing binding), returns { success: false, existing_binding: {...} }.
 * The game shows Keep/Replace UI. To replace, call promptConnectWallet({ force: true }).
 *
 * @param opts.reason  Context string shown in the confirm dialog / modal label.
 * @param opts.force   Use cached 409 proof to call /wallet/bind/force without reopening modal.
 */
export async function promptConnectWallet(
  opts?: { reason?: string; force?: boolean }
): Promise<ConnectResult> {
  if (_isMock()) return mockPromptConnectWallet(opts)

  const tc = getTonConnect()

  // Force bind: use address + proof cached from the last 409 response.
  if (opts?.force) {
    if (!_pendingForceBind) {
      return { success: false, error: 'no_pending_bind' }
    }
    try {
      const { status, data } = await walletFetch<WalletBinding>(
        'POST', '/wallet/bind/force', _pendingForceBind
      )
      _pendingForceBind = null
      if (status === 200) {
        _lastBinding = data
        return { success: true, address: data.address, tier: data.tier }
      }
      return { success: false, error: `force_bind_failed_${status}` }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  // Normal flow: disconnect TC first to guarantee a fresh tonProof on reconnect.
  if (tc.connected) {
    await tc.disconnect()
  }

  const payload = `arcade-${Date.now()}-${Math.random().toString(36).slice(2)}`
  tc.setConnectRequestParameters({ state: 'ready', value: { tonProof: payload } })

  return new Promise<ConnectResult>((resolve) => {
    let settled = false
    let unsubStatus: (() => void) | null = null
    let unsubModal: (() => void) | null = null

    function settle(result: ConnectResult): void {
      if (settled) return
      settled = true
      unsubStatus?.()
      unsubModal?.()
      tc.setConnectRequestParameters(null)
      resolve(result)
    }

    unsubStatus = tc.onStatusChange(async (wallet) => {
      if (!wallet) return

      const address = wallet.account.address
      const network = wallet.account.chain
      const proofReply = wallet.connectItems?.tonProof

      if (!proofReply || !('proof' in proofReply)) {
        settle({ success: false, error: 'tonproof_failed' })
        return
      }

      const tonProof = (proofReply as TonProofItemReplySuccess).proof

      try {
        const { status, data } = await walletFetch<
          WalletBinding | { existing: { address: string; tier: HolderTier; bind_source: string } } | { error?: string }
        >('POST', '/wallet/bind', { address, ton_proof: tonProof, network })

        if (status === 200) {
          const ok = data as WalletBinding
          _lastBinding = ok
          _pendingForceBind = null
          settle({ success: true, address: ok.address, tier: ok.tier })
        } else if (status === 409) {
          _pendingForceBind = { address, ton_proof: tonProof, network }
          const conflict = data as { existing: { address: string; tier: HolderTier; bind_source: string } }
          settle({ success: false, existing_binding: conflict.existing })
        } else {
          const errData = data as { error?: string; detail?: string }
          settle({ success: false, error: errData.error ?? errData.detail ?? `bind_failed_${status}` })
        }
      } catch (err) {
        settle({ success: false, error: String(err) })
      }
    })

    unsubModal = tc.onModalStateChange((state) => {
      if (state.status === 'closed' && state.closeReason === 'action-cancelled') {
        settle({ success: false, error: 'dismissed' })
      }
    })

    void tc.openModal()
  })
}

/**
 * refreshTier()
 *
 * Requests a fresh $YODA balance snapshot and returns the current tier.
 * Fires onTierChange() callbacks if the tier changed since last snapshot.
 * Throws on 429 rate-limit -- caller should handle gracefully.
 */
export async function refreshTier(): Promise<{ tier: HolderTier; changed: boolean }> {
  if (_isMock()) return mockRefreshTier()

  const { status, data } = await walletFetch<{ tier: HolderTier; changed: boolean; balance_yoda: number }>(
    'POST', '/wallet/refresh', {}
  )

  if (status === 429) throw new Error('rate_limited')
  if (status !== 200) throw new Error(`refresh_failed_${status}`)

  if (data.changed && _lastBinding) {
    const event: TierChangeEvent = {
      old_tier: _lastBinding.tier,
      new_tier: data.tier,
      balance_yoda: data.balance_yoda,
    }
    _lastBinding.tier = data.tier
    _lastBinding.balance_yoda = data.balance_yoda
    for (const cb of _tierChangeCallbacks) cb(event)
  }

  return { tier: data.tier, changed: data.changed }
}

/**
 * openSettings(section?)
 *
 * Asks the host shell to open the Settings screen.
 * Posts { type: 'OPEN_SETTINGS', section } to window.parent.
 * No-ops (console.warn) when running standalone (no parent shell).
 */
export function openSettings(section?: 'wallet' | 'sound' | 'haptics' | 'about'): void {
  if (window.parent === window) {
    console.warn('openSettings: no parent shell detected -- running standalone?')
    return
  }
  window.parent.postMessage({ type: 'OPEN_SETTINGS', section }, '*')
}

/**
 * onTierChange(callback)
 *
 * Subscribe to holder-tier change events. Fires when refreshTier()
 * (or the background stale-snapshot refresh) detects a tier change.
 * Returns an unsubscribe function.
 */
export function onTierChange(cb: (e: TierChangeEvent) => void): () => void {
  _tierChangeCallbacks.push(cb)
  return () => { _tierChangeCallbacks = _tierChangeCallbacks.filter((fn) => fn !== cb) }
}

// -- Accessors ----------------------------------------------------------------

export function getGameId(): string  { return _gameId }
export function getUserId(): string  { return _userId }
export function hasToken(): boolean  { return _sessionToken.length > 0 }

/** Current holder tier -- defaults 'initiate' until session resolves or if backend omits field. */
export function getHolderTier(): HolderTier { return _holderTier }

/** Daily plays remaining -- set from session response; defaults 3 (initiate cap). */
export function getDailyPlaysRemaining(): number { return _dailyPlaysRemaining }

// -- Window type augmentation -------------------------------------------------

declare global {
  interface Window {
    __mockBindWallet: (address?: string, tier?: HolderTier) => void
    __mockDisconnect: () => void
    __mockSetTier: (tier: HolderTier) => void
    __mockStaleSnapshot: () => void
    __mockUnverifyProof: () => void
  }
}
