/**
 * Fixed-step physics driver for Sticker Galaxy esport core.
 *
 * Contract: tick = 16.666ms; physics must consume integer ticks only.
 * This ensures identical simulation regardless of display frame rate.
 *
 * Usage in Phaser scene.update(time, delta):
 *
 *   const acc = new FixedStepAccumulator();
 *
 *   // In update():
 *   acc.update(delta, () => {
 *     updatePhysics(state, TICK_DT, canvasW, canvasH);
 *     state.tick++;
 *   });
 *
 * Phaser config for Phaser physics users (not required for custom physics):
 *   physics: { arcade: { fixedStep: true, fps: 60 } }
 *
 * Note: MAX_TICKS_PER_FRAME caps catchup to 3 ticks to prevent
 * spiral-of-death when tab regains focus after a period of inactivity.
 */

export const TICK_MS = 1000 / 60   // ~16.667ms per physics tick
export const TICK_DT = 1 / 60      // seconds per tick

const MAX_TICKS_PER_FRAME = 3      // spiral-of-death guard

export class FixedStepAccumulator {
  private acc = 0

  /**
   * Called every render frame with the real elapsed ms (Phaser `delta`).
   * Fires `tick()` once per accumulated fixed step, up to MAX_TICKS_PER_FRAME.
   * Returns the number of ticks fired this frame.
   */
  update(deltaMs: number, tick: () => void): number {
    this.acc += deltaMs
    let count = 0
    while (this.acc >= TICK_MS && count < MAX_TICKS_PER_FRAME) {
      this.acc -= TICK_MS
      tick()
      count++
    }
    return count
  }

  /**
   * Reset the accumulator.
   * Call at game-start to avoid carrying over stale accumulated time
   * from before the run began.
   */
  reset(): void {
    this.acc = 0
  }
}
