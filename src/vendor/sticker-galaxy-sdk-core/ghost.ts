/**
 * GhostTrack — stores and queries a stream of {tick, x, y} samples
 * from a replay or live run.
 *
 * Used by the overlay renderer to position a ghost sprite at any tick.
 * Query via sampleAt(tick) → linearly interpolated position or null.
 *
 * In endless runners the player's screen X is usually fixed; Y varies
 * by jump/fall, so the ghost primarily shows height profile over time.
 *
 * Usage:
 *   // During recording:
 *   const track = new GhostTrack();
 *   track.addSample(state.tick, player.x, player.screenY);
 *
 *   // During playback:
 *   const pos = track.sampleAt(currentTick);
 *   if (pos) ghostSprite.setY(pos.y);
 *
 *   // Serialize / load:
 *   const saved = track.toArray();
 *   const loaded = new GhostTrack(saved);
 */

export interface GhostPoint {
  tick: number
  x: number
  y: number
}

export class GhostTrack {
  private _samples: GhostPoint[]

  constructor(samples?: GhostPoint[]) {
    this._samples = samples ? [...samples] : []
  }

  /** Append a sample. Samples MUST be added in ascending tick order. */
  addSample(tick: number, x: number, y: number): void {
    this._samples.push({ tick, x, y })
  }

  /**
   * Query interpolated position at the given tick.
   *
   * Returns null if:
   *   - No samples recorded
   *   - tick < first sample tick (before ghost started)
   *   - tick > last sample tick (ghost run has ended)
   *
   * Linear interpolation between the two nearest samples.
   */
  sampleAt(tick: number): { x: number; y: number } | null {
    const s = this._samples
    if (s.length === 0) return null
    if (tick < s[0].tick || tick > s[s.length - 1].tick) return null

    // Binary search for the bracketing pair
    let lo = 0
    let hi = s.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (s[mid].tick <= tick) lo = mid
      else hi = mid
    }

    const a = s[lo]
    const b = s[hi]

    if (a.tick === b.tick) return { x: a.x, y: a.y }

    const t = (tick - a.tick) / (b.tick - a.tick)
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    }
  }

  /** Total number of recorded samples. */
  get length(): number {
    return this._samples.length
  }

  /** Export a copy of the samples array for serialization / storage. */
  toArray(): GhostPoint[] {
    return [...this._samples]
  }
}
