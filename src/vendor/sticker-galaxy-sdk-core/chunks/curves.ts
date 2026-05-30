/**
 * src/chunks/curves.ts — Difficulty curves for Sticker Galaxy esport modes.
 *
 * Each curve is a piecewise-linear sampler. difficultyAt(t_ms, mode) returns
 * a float in [1, 10] that the ChunkPicker uses to select chunks.
 * The picker calls Math.floor(difficultyAt(t)) and picks from ±1 bucket.
 */

import type { Mode } from '../modes.js'

export interface CurvePoint {
  t_ms: number
  d: number
}

export type Curve = CurvePoint[]

// ── Canonical curves ──────────────────────────────────────────────────────────

/** Casual: soft ramp, plateaus at 6 after 2 minutes. */
export const CASUAL_CURVE: Curve = [
  { t_ms: 0,       d: 1 },
  { t_ms: 10_000,  d: 2 },
  { t_ms: 30_000,  d: 4 },
  { t_ms: 60_000,  d: 5 },
  { t_ms: 120_000, d: 6 },
  { t_ms: 600_000, d: 6 },
]

/** Daily: same ramp as casual but spikes to 9 at 3 minutes (PB-chasing). */
export const DAILY_CURVE: Curve = [
  { t_ms: 0,       d: 1 },
  { t_ms: 30_000,  d: 4 },
  { t_ms: 90_000,  d: 7 },
  { t_ms: 180_000, d: 9 },
  { t_ms: 600_000, d: 9 },
]

/** Tournament: hard ramp, no slack — starts at 3, hits 10 by 75s. */
export const TOURNEY_CURVE: Curve = [
  { t_ms: 0,       d: 3 },
  { t_ms: 20_000,  d: 6 },
  { t_ms: 45_000,  d: 8 },
  { t_ms: 75_000,  d: 10 },
  { t_ms: 600_000, d: 10 },
]

// ── Sampler ───────────────────────────────────────────────────────────────────

/** Linear interpolation between breakpoints. */
export function sampleCurve(curve: Curve, t_ms: number): number {
  if (t_ms <= curve[0].t_ms) return curve[0].d
  const last = curve[curve.length - 1]
  if (t_ms >= last.t_ms) return last.d

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]
    const b = curve[i + 1]
    if (t_ms >= a.t_ms && t_ms <= b.t_ms) {
      const alpha = (t_ms - a.t_ms) / (b.t_ms - a.t_ms)
      return a.d + (b.d - a.d) * alpha
    }
  }
  return last.d
}

/**
 * Returns the target difficulty (float in [1, 10]) at time t_ms for
 * the given mode. ChunkPicker calls Math.floor(result) and picks from
 * the [target-1, target+1] bucket.
 */
export function difficultyAt(t_ms: number, mode: Mode): number {
  switch (mode) {
    case 'daily':   return sampleCurve(DAILY_CURVE, t_ms)
    case 'tourney': return sampleCurve(TOURNEY_CURVE, t_ms)
    default:        return sampleCurve(CASUAL_CURVE, t_ms)  // casual / pro
  }
}
