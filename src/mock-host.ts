// ─────────────────────────────────────────────────────────────────────────────
// mock-host.ts — Swamp Runner wallet mock (offline dev / no-token mode)
//
// Only wallet endpoints are mocked here.  The game session (entry, result,
// submit) falls through to the real API and surfaces "Demo mode" errors in the
// UI — that existing path is intentional and unchanged.
//
// All state lives in localStorage under sg_arcade_mock_wallet so it survives
// page reloads during dev.
//
// AI ASSISTANTS:
//   Do NOT add fetch() calls here.  Functions are called by sdk.ts
//   when !hasToken().  Keep signatures matching the WalletBinding / ConnectResult
//   types exported from sdk.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { WalletBinding, ConnectResult, HolderTier } from './sdk.js'

// ── Storage ────────────────────────────────────────────────────────────────────

const WALLET_KEY = 'sg_arcade_mock_wallet'

type WalletMockState = 'unbound' | 'bound-fresh' | 'bound-stale' | 'bound-unverified'

interface MockWalletData {
  state: WalletMockState
  address: string
  tier: HolderTier
  balance_yoda: number
  last_snapshot_at: string
  tonproof_verified: boolean
}

function loadWalletState(): MockWalletData | null {
  try {
    const raw = localStorage.getItem(WALLET_KEY)
    if (raw) return JSON.parse(raw) as MockWalletData
  } catch {
    // ignore parse errors
  }
  return null
}

function saveWalletState(data: MockWalletData): void {
  localStorage.setItem(WALLET_KEY, JSON.stringify(data))
}

function defaultWalletData(): MockWalletData {
  return {
    state: 'bound-fresh',
    address: `EQ${Math.random().toString(36).slice(2, 12).toUpperCase()}mock`,
    tier: 'padawan',
    balance_yoda: 2500,
    last_snapshot_at: new Date().toISOString(),
    tonproof_verified: true,
  }
}

// ── Logging ─────────────────────────────────────────────────────────────────────

function mockLog(endpoint: string, req: unknown, res: unknown): void {
  console.group(`[MOCK WALLET] ${endpoint}`)
  console.log('→ Request:', req)
  console.log('← Response:', res)
  console.groupEnd()
}

function delay(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Mock wallet functions ───────────────────────────────────────────────────────

/**
 * Simulates GET /arcade/v0/wallet
 * Returns null when unbound, WalletBinding when bound.
 */
export async function mockGetWalletBinding(): Promise<WalletBinding | null> {
  await delay(200)
  const wallet = loadWalletState()
  if (!wallet || wallet.state === 'unbound') {
    mockLog('GET /arcade/v0/wallet', {}, { address: null })
    return null
  }
  const binding: WalletBinding = {
    address: wallet.address,
    tier: wallet.tier,
    balance_yoda: wallet.balance_yoda,
    last_snapshot_at: wallet.last_snapshot_at,
    bind_source: 'arcade',
    address_public: true,
    tonproof_verified: wallet.tonproof_verified,
  }
  mockLog('GET /arcade/v0/wallet', {}, binding)
  return binding
}

/**
 * Simulates the wallet connect + bind flow.
 * Shows a native confirm() dialog: Accept → bound-fresh padawan, Cancel → dismissed.
 */
export async function mockPromptConnectWallet(
  opts?: { reason?: string; force?: boolean }
): Promise<ConnectResult> {
  await delay(100)
  const label = opts?.reason ? ` (${opts.reason})` : ''
  const confirmed = window.confirm(
    `[MOCK] Connect wallet to Arcade${label}?\n\nAccept = bind padawan wallet\nCancel = dismiss`
  )
  if (!confirmed) {
    return { success: false, error: 'dismissed' }
  }
  const data = defaultWalletData()
  saveWalletState(data)
  mockLog('POST /arcade/v0/wallet/bind [mock]', { force: opts?.force }, { tier: data.tier, address: data.address })
  return { success: true, address: data.address, tier: data.tier }
}

/**
 * Simulates POST /arcade/v0/wallet/refresh.
 * Returns changed=true when state is 'bound-stale', resets snapshot to now.
 */
export async function mockRefreshTier(): Promise<{ tier: HolderTier; changed: boolean }> {
  await delay(300)
  const wallet = loadWalletState()
  if (!wallet || wallet.state === 'unbound') {
    throw new Error('[MOCK] No wallet bound — cannot refresh tier')
  }
  const changed = wallet.state === 'bound-stale'
  if (changed) {
    wallet.state = 'bound-fresh'
    wallet.last_snapshot_at = new Date().toISOString()
    saveWalletState(wallet)
  }
  const result = { tier: wallet.tier, changed }
  mockLog('POST /arcade/v0/wallet/refresh', {}, { ...result, balance_yoda: wallet.balance_yoda })
  return result
}

// ── Window dev helpers ─────────────────────────────────────────────────────────
// Assigned to window.__ in sdk.ts setupDevHelpers() when running in DEV mode.

/** Bind a mock wallet. Optional address and tier override defaults. */
export function mockBindWallet(address?: string, tier?: HolderTier): void {
  const data = defaultWalletData()
  if (address) data.address = address
  if (tier) data.tier = tier
  saveWalletState(data)
  console.log(`[MOCK WALLET] Bound: ${data.address} (${data.tier})`)
}

/** Reset wallet to unbound state. */
export function mockDisconnectWallet(): void {
  saveWalletState({
    state: 'unbound',
    address: '',
    tier: 'initiate',
    balance_yoda: 0,
    last_snapshot_at: new Date().toISOString(),
    tonproof_verified: false,
  })
  console.log('[MOCK WALLET] Disconnected — state reset to unbound')
}

/** Change tier on existing bound wallet. */
export function mockSetTier(tier: HolderTier): void {
  const wallet = loadWalletState()
  if (!wallet || wallet.state === 'unbound') {
    console.warn('[MOCK WALLET] No bound wallet — call __mockBindWallet() first')
    return
  }
  wallet.tier = tier
  saveWalletState(wallet)
  console.log(`[MOCK WALLET] Tier set to ${tier}`)
}

/** Set last_snapshot_at to 48h ago to trigger stale refresh on next getWalletBinding(). */
export function mockStaleSnapshot(): void {
  const wallet = loadWalletState()
  if (!wallet || wallet.state === 'unbound') {
    console.warn('[MOCK WALLET] No bound wallet — call __mockBindWallet() first')
    return
  }
  wallet.state = 'bound-stale'
  wallet.last_snapshot_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  saveWalletState(wallet)
  console.log('[MOCK WALLET] Snapshot aged 48h — next getWalletBinding() triggers background refresh')
}

/** Set tonproof_verified=false on existing bound wallet. */
export function mockUnverifyProof(): void {
  const wallet = loadWalletState()
  if (!wallet || wallet.state === 'unbound') {
    console.warn('[MOCK WALLET] No bound wallet — call __mockBindWallet() first')
    return
  }
  wallet.tonproof_verified = false
  wallet.state = 'bound-unverified'
  saveWalletState(wallet)
  console.log('[MOCK WALLET] tonproof_verified set to false')
}
