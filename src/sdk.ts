/// <reference types="vite/client" />
/**
 * src/sdk.ts — Sticker Galaxy Arcade SDK v0 wrapper
 *
 * Wraps every arcade endpoint with:
 *   - Authorization: Bearer <session_token>  (from URL params)
 *   - X-Game-Id: <game_id>                   (from URL params / env)
 *
 * Every method returns { success: true, data } or { success: false, error }.
 * It NEVER throws to game code.
 *
 * SDK spec: https://docs-site-taupe-pi.vercel.app/sdk/
 */

// ── Config ──────────────────────────────────────────────────────────────────

const API_BASE: string =
  (import.meta.env.VITE_ARCADE_API_URL as string | undefined) ??
  'https://babyyoda-bot.fly.dev'

// ── URL param helpers ────────────────────────────────────────────────────────

function getParam(key: string): string {
  const params = new URLSearchParams(window.location.search)
  return params.get(key) ?? ''
}

// ── Module state ─────────────────────────────────────────────────────────────

let _sessionToken: string = ''
let _userId: string = ''
let _gameId: string = ''
let _proofOfPlayToken: string = ''
let _holderTier: HolderTier = 'initiate'
let _dailyPlaysRemaining: number = 3

// ── Types ────────────────────────────────────────────────────────────────────

export interface SDKResult<T> {
  success: true
  data: T
}
export interface SDKError {
  success: false
  error: string
}
export type SDKResponse<T> = SDKResult<T> | SDKError

// Holder tier levels — maps to YODA balance thresholds on the platform.
export type HolderTier = 'initiate' | 'padawan' | 'knight' | 'master' | 'grandmaster'

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

// ── Internal fetch wrapper ───────────────────────────────────────────────────

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

// ── Public API ───────────────────────────────────────────────────────────────

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
 * Bank a practice result — mints midi, counts toward daily cap, awards trophies
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

// ── postMessage bridge ───────────────────────────────────────────────────────

type HostMessageType =
  | 'SESSION_INIT'
  | 'PURCHASE_CONFIRMED'
  | 'PURCHASE_FAILED'
  | 'SESSION_EXPIRING'
  | 'SESSION_KILLED'

type HostMessageHandler = (data: Record<string, unknown>) => void

const _listeners: Partial<Record<HostMessageType, HostMessageHandler>> = {}

/** Register a listener for host→game postMessage events. */
export function onHostMessage(
  type: HostMessageType,
  handler: HostMessageHandler,
): void {
  _listeners[type] = handler
}

/** Send a game→host postMessage. */
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
 * Request a purchase — convenience alias for `purchase` with (description, currency)
 * parameter order matching arcade UI call-sites.
 * item_type: 'cosmetic_skin' | 'extra_play' | 'tournament_entry'
 * currency:  'TON' | 'Stars' | 'YODA'
 */
export async function requestPurchase(
  itemType: 'cosmetic_skin' | 'extra_play' | 'tournament_entry',
  itemId: string,
  price: number,
  description: string,
  currency: 'TON' | 'Stars' | 'YODA',
): Promise<SDKResponse<PurchaseData>> {
  return purchase(itemType, itemId, price, currency, description)
}

// ── Accessors ────────────────────────────────────────────────────────────────

export function getGameId(): string  { return _gameId }
export function getUserId(): string  { return _userId }
export function hasToken(): boolean  { return _sessionToken.length > 0 }

/** Current holder tier — defaults 'initiate' until session resolves or if backend omits field. */
export function getHolderTier(): HolderTier { return _holderTier }

/** Daily plays remaining — set from session response; defaults 3 (initiate cap). */
export function getDailyPlaysRemaining(): number { return _dailyPlaysRemaining }
