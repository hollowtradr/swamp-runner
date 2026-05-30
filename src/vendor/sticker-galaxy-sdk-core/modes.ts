/**
 * Game modes and seed derivation for Sticker Galaxy esport core.
 *
 * Modes:
 *   casual  — fresh seed each run (default)
 *   daily   — one seed per UTC day, shared across all players
 *   tourney — fixed seed for a tournament bracket
 *   pro     — no IAP impacts, eligible for global leaderboard (Phase 4+)
 */

export type Mode = 'casual' | 'daily' | 'tourney' | 'pro'

/**
 * Derive a stable daily seed from a UTC date string and game id.
 *
 * Uses FNV-1a 32-bit hashing — stable across all JS engines and platforms.
 * Same (date_utc, gameId) always produces the same uint32 seed.
 *
 * @param date_utc  ISO date string "YYYY-MM-DD"
 * @param gameId    Game identifier, e.g. "swamp_runner"
 */
export function deriveDailySeed(date_utc: string, gameId: string): number {
  const input = `${date_utc}:${gameId}`
  let hash = 0x811c9dc5  // FNV-1a 32-bit offset basis

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // FNV-1a prime: 0x01000193 (16777619)
    hash = (Math.imul(hash, 0x01000193) >>> 0)
  }

  return hash >>> 0
}

/**
 * Returns the daily seed for today (UTC) and the given game id.
 *
 * Two calls within the same UTC day always return the same value.
 * Rolls over at midnight UTC.
 */
export function dailySeedForToday(gameId: string): number {
  const today = new Date().toISOString().slice(0, 10)  // "YYYY-MM-DD"
  return deriveDailySeed(today, gameId)
}
