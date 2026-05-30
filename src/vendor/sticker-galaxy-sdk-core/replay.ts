/**
 * Replay primitives for Sticker Galaxy esport core.
 *
 * A run = { seed, mode, build_hash, started_at, inputs[], ghost_samples[], final_score }
 *
 * The verify stub takes engine(seed, inputs) → score so each game plugs in its own
 * headless simulator. Full server-side verification is Phase 3.
 *
 * Wire:
 *   1. createReplay() on run start
 *   2. recordInput() on each player action
 *   3. recordGhostSample() every N ticks for ghost track
 *   4. replay.final_score = state.score on run end
 *   5. serialize() to persist in localStorage / send to backend
 *   6. deserialize() to reload for ghost rendering
 */

export interface InputEvent {
  /** Physics tick at which this input fired. */
  tick: number
  /** Input action type. */
  type: 'jump_start' | 'jump_release' | 'double_jump' | 'slide'
  /** Optional associated value (e.g. hold duration for jump_release). */
  value?: number
}

export interface GhostSample {
  /** Physics tick for this sample. */
  tick: number
  /** Player screen X at this tick. */
  x: number
  /** Player screenY (top-left of sprite) at this tick. */
  y: number
}

export interface Replay {
  seed: number
  mode: string
  build_hash: string
  /** Unix timestamp (ms) when the run started. */
  started_at: number
  inputs: InputEvent[]
  ghost_samples: GhostSample[]
  final_score: number
  /**
   * Hash of terminal physics state for future server-side verification.
   * Format: "<score>:<tick>:<worldOffset>" for Phase 1 (not cryptographically secure).
   */
  terminal_state_hash: string
}

/** Create a fresh replay for a new run. */
export function createReplay(
  seed: number,
  mode: string,
  build_hash: string,
): Replay {
  return {
    seed,
    mode,
    build_hash,
    started_at: Date.now(),
    inputs: [],
    ghost_samples: [],
    final_score: 0,
    terminal_state_hash: '',
  }
}

/** Append an input event to the replay. */
export function recordInput(replay: Replay, event: InputEvent): void {
  replay.inputs.push(event)
}

/** Append a ghost track sample to the replay. */
export function recordGhostSample(replay: Replay, tick: number, x: number, y: number): void {
  replay.ghost_samples.push({ tick, x, y })
}

/** Serialize a replay to a JSON string for storage. */
export function serialize(replay: Replay): string {
  return JSON.stringify(replay)
}

/** Deserialize a replay from a JSON string. */
export function deserialize(data: string): Replay {
  const r = JSON.parse(data) as Replay
  if (typeof r.seed !== 'number') throw new Error('Invalid replay: missing seed')
  if (typeof r.mode !== 'string') throw new Error('Invalid replay: missing mode')
  if (!Array.isArray(r.inputs)) throw new Error('Invalid replay: inputs must be array')
  if (!Array.isArray(r.ghost_samples)) r.ghost_samples = []
  return r
}

/**
 * Verify a replay by running it through the provided engine function.
 *
 * The engine must be a pure function:
 *   engine(seed, inputs) → score
 *
 * Returns true if the engine's simulated score matches replay.final_score.
 *
 * NOTE: Phase 1 stub — no cryptographic guarantee.
 *       Phase 3 moves this to server-side with the headless build.
 */
export function verify(
  replay: Replay,
  engine: (seed: number, inputs: InputEvent[]) => number,
): boolean {
  const simulatedScore = engine(replay.seed, replay.inputs)
  return simulatedScore === replay.final_score
}
