/**
 * SeededRNG — mulberry32 PRNG.
 *
 * Deterministic, fast, sufficient quality for endless-runner spawning.
 * Same seed → same sequence across all builds and platforms.
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export class SeededRNG {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** Returns a float in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Returns an integer in [min, max). */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min
  }

  /** Picks a random element from an array. */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length)]
  }

  /** Returns current internal state (for cloning/checkpointing). */
  getState(): number {
    return this.s
  }

  /** Restore previously captured state. */
  setState(s: number): void {
    this.s = s >>> 0
  }

  /** Clone this RNG (same sequence from this point onward). */
  clone(): SeededRNG {
    const r = new SeededRNG(0)
    r.s = this.s
    return r
  }
}
