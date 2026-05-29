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
let _paidPlaysRemaining: number = 0

// -- Wallet state -------------------------------------------------------------

/** Cache of last-known wallet binding. Updated by getWalletBinding() and promptConnectWallet(). */
let _lastBinding: WalletBinding | null = null

/** Registered tier-change callbacks. Fired when refreshTier() returns changed=true, or when the parent shell broadcasts SG_TIER_CHANGED. */
let _tierChangeCallbacks: Array<(e: TierChangeEvent) => void> = []

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
  /** Free plays remaining today (tier-granted). 0-3 for Initiate, up to 7 for Grandmaster. */
  daily_plays_remaining: number
  /** Additional plays the user can purchase today before the universal
   *  daily ceiling (7) kicks in. Initiate=4, Padawan=3, Knight=2, Master=1, Grandmaster=0. */
  paid_plays_remaining?: number
  /** Tier's free quota (3-7). */
  free_plays_cap?: number
  /** Universal daily ceiling — always 7 regardless of tier. */
  absolute_play_cap?: number
  is_featured_game_today: boolean
  proof_of_play_token: string
  session_expires_at: string
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

export interface TonPaymentBlock {
  to: string
  amount_nanoton: string
  comment: string
  valid_until: number
}

export interface PurchaseData {
  purchase_id: string
  status: 'pending' | 'awaiting_payment' | 'paid_pending' | 'paid' | 'expired' | 'failed'
  payment_url: string | null
  ton_payment: TonPaymentBlock | null
  studio_credit_ton: number
  message: string
}

export interface PurchaseStatusData {
  purchase_id: string
  status: 'pending' | 'awaiting_payment' | 'paid_pending' | 'paid' | 'expired' | 'failed'
  currency: string
  item_type: string
  item_id: string
  tx_hash: string | null
  settled_at: string | null
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

// ─── Wallet RPC (shell-owned architecture) ──────────────────────────────────
//
// Wallet operations are owned by the Sticker Galaxy platform shell — NOT by
// games. The shell runs TonConnect in TWA top-level context where twaReturnUrl
// works correctly; games delegate via postMessage RPC.
//
// Wire envelope:
//   from iframe → shell:  { type: 'SG_WALLET_RPC', method, requestId, params? }
//   from shell → iframe:  { type: 'SG_WALLET_RPC_RESULT', requestId, ok, data?, error? }
//   shell broadcast:      { type: 'SG_TIER_CHANGED', binding }
//
// Standalone dev (no shell): walletRpc() rejects with 'shell_required'.
// SDK callers catch this and degrade gracefully (mock mode for `npm run dev`).

const _WALLET_RPC_TIMEOUT_MS = 60_000  // wallet connect can take a while

function walletRpc<T>(method: string, params?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || window.parent === window) {
      reject(new Error('shell_required'))
      return
    }
    const requestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error(`wallet_rpc_timeout_${method}`))
    }, _WALLET_RPC_TIMEOUT_MS)

    function onMessage(e: MessageEvent): void {
      const d = e.data as { type?: string; requestId?: string; ok?: boolean; data?: unknown; error?: string } | null
      if (!d || d.type !== 'SG_WALLET_RPC_RESULT' || d.requestId !== requestId) return
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (d.ok) resolve(d.data as T)
      else reject(new Error(d.error ?? 'wallet_rpc_failed'))
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage(
      { type: 'SG_WALLET_RPC', method, requestId, params },
      '*',  // shell validates origin server-side
    )
  })
}

// Listen for shell-broadcast tier changes (fires when user binds/disconnects
// from the Settings sheet, or when a background snapshot refresh updates tier).
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; binding?: WalletBinding | null } | null
  if (!d || d.type !== 'SG_TIER_CHANGED') return
  const newBinding = d.binding ?? null
  const oldBinding = _lastBinding
  const oldTier = oldBinding?.tier ?? 'initiate'
  const newTier = newBinding?.tier ?? 'initiate'
  const boundChanged = (oldBinding == null) !== (newBinding == null)
  const addressChanged = oldBinding != null && newBinding != null && oldBinding.address !== newBinding.address
  _lastBinding = newBinding
  // Fire on any meaningful change: tier, bound↔unbound, or wallet swap.
  // The previous tier-only check missed disconnect from bound+initiate → unbound
  // (both resolve to 'initiate'), leaving the UI stuck on the bound state.
  if (oldTier !== newTier || boundChanged || addressChanged) {
    const event: TierChangeEvent = {
      old_tier: oldTier,
      new_tier: newTier,
      balance_yoda: newBinding?.balance_yoda ?? 0,
    }
    for (const cb of _tierChangeCallbacks) cb(event)
  }
})

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
    _paidPlaysRemaining = result.data.paid_plays_remaining ?? 0
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
  opts: { extraPlayPurchaseId?: string } = {},
): Promise<SDKResponse<SubmitData>> {
  const body: Record<string, unknown> = { result_id: resultId }
  if (opts.extraPlayPurchaseId) body.extra_play_purchase_id = opts.extraPlayPurchaseId
  return apiFetch<SubmitData>('/arcade/v0/submit', {
    method: 'POST',
    body: JSON.stringify(body),
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
 * Route a real-money purchase.
 *
 * - Stars: not yet wired; falls back to legacy purchase row creation.
 * - TON:   creates a purchase row, prompts wallet connect if needed, signs
 *          the TX via the platform shell's TonConnect, and returns once the
 *          backend has marked the row paid_pending. Use getPurchaseStatus()
 *          to poll for the final 'paid' confirmation (~10–15s).
 * - YODA:  not yet wired (Phase 3); falls back to legacy purchase row.
 *
 * Error codes (returned in SDKError.error):
 *   - 'wallet_required'   user dismissed wallet connect prompt
 *   - 'user_rejected'     user rejected the TX in their wallet
 *   - 'sign_failed'       wallet returned a signing error
 *   - 'purchase_failed'   backend purchase creation failed
 *   - 'shell_unavailable' running standalone, no platform shell RPC
 */
export async function requestPurchase(
  itemType: 'cosmetic_skin' | 'extra_play' | 'tournament_entry',
  itemId: string,
  price: number,
  description: string,
  currency: 'TON' | 'Stars' | 'YODA',
): Promise<SDKResponse<PurchaseData>> {
  // JIT wallet check -- TON and YODA require a bound wallet.
  if (currency === 'TON' || currency === 'YODA') {
    const binding = await getWalletBinding()
    if (!binding) {
      const connectResult = await promptConnectWallet({ reason: 'purchase' })
      if (!connectResult.success) {
        return { success: false, error: 'wallet_required' }
      }
    }
  }

  // Phase 2: full TON payment flow.
  if (currency === 'TON') {
    // 1. Create the purchase row — backend returns ton_payment block.
    const created = await purchase(itemType, itemId, price, currency, description)
    if (!created.success) return created
    const tp = created.data.ton_payment
    if (!tp) {
      return { success: false, error: 'no_ton_payment_block' }
    }

    // 2. Ask the platform shell to sign + submit. Shell-owned because only
    //    the TWA top-level frame has working TonConnect twaReturnUrl context.
    const signResult = await walletRpc<{
      success: boolean
      purchase_id?: string
      payer_address?: string
      status?: string
      error?: string
      message?: string
    }>('requestTonPayment', {
      purchase_id: created.data.purchase_id,
      ton_payment: tp,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg === 'shell_required' ? 'shell_unavailable' : msg }
    })

    if (!signResult.success) {
      return {
        success: false,
        error: signResult.error ?? 'sign_failed',
      }
    }

    // 3. Optimistic: return the purchase row updated to paid_pending. The
    //    game can immediately grant the item (revive / extra play / etc).
    //    Use getPurchaseStatus() to poll for the on-chain confirmation.
    return {
      success: true,
      data: {
        ...created.data,
        status: 'paid_pending',
      },
    }
  }

  // Stars and YODA: legacy path (stub URL) until their dedicated flows ship.
  return purchase(itemType, itemId, price, currency, description)
}

/**
 * Poll for purchase confirmation. Called after requestPurchase returns
 * paid_pending to wait for the on-chain settlement (~10–15s for TON).
 *
 * Backend rows transition: awaiting_payment -> paid_pending -> paid | expired.
 */
export async function getPurchaseStatus(
  purchaseId: string,
): Promise<SDKResponse<PurchaseStatusData>> {
  return apiFetch<PurchaseStatusData>(
    `/arcade/v0/purchase/${encodeURIComponent(purchaseId)}`,
  )
}

/**
 * Convenience: poll getPurchaseStatus every `intervalMs` until status is
 * terminal (paid / expired / failed) or `timeoutMs` elapses. Returns the
 * final status row.
 */
export async function awaitPurchaseConfirmation(
  purchaseId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<SDKResponse<PurchaseStatusData>> {
  const intervalMs = opts.intervalMs ?? 3000
  const timeoutMs = opts.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await getPurchaseStatus(purchaseId)
    if (!res.success) return res
    if (res.data.status === 'paid' || res.data.status === 'expired' || res.data.status === 'failed') {
      return res
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { success: false, error: 'confirmation_timeout' }
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
    const binding = await walletRpc<WalletBinding | null>('getWalletBinding')
    _lastBinding = binding
    return binding
  } catch (err) {
    // shell_required (standalone) or RPC timeout → render as unbound
    if (err instanceof Error && err.message === 'shell_required') return null
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
  try {
    const result = await walletRpc<ConnectResult>('promptConnectWallet', opts ?? {})
    if (result.success && result.address && result.tier) {
      // Keep local cache fresh — the shell already broadcasts SG_TIER_CHANGED,
      // but caching here avoids a round-trip for the next getWalletBinding().
      _lastBinding = {
        address: result.address,
        tier: result.tier,
        balance_yoda: _lastBinding?.balance_yoda ?? 0,
        last_snapshot_at: new Date().toISOString(),
        bind_source: 'arcade',
        address_public: false,
        tonproof_verified: true,
      }
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
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
  // Shell handles rate-limiting and broadcasts SG_TIER_CHANGED on change.
  const data = await walletRpc<{ tier: HolderTier; changed: boolean; balance_yoda: number }>('refreshTier')
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
export function getPaidPlaysRemaining(): number { return _paidPlaysRemaining }
/** Local-only decrement after a successful extra-play purchase, so the UI
 *  can hide the buy pill once the cap is reached without waiting for the
 *  next /session refresh. Clamped at 0. */
export function decrementPaidPlaysRemaining(n: number = 1): void {
  _paidPlaysRemaining = Math.max(0, _paidPlaysRemaining - n)
}

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
