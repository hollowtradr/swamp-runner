# Esport Phase 2: Pattern Chunks + Composition

**Goal:** Replace the IID-per-tick spawner with hand-authored chunks
composed by a deterministic picker, so runs become **learnable** (memorable
shapes, optimal lines, route-able). Same seed already produces same chunk
sequence (Phase 1 wired the RNG). This phase makes that sequence
*meaningful*.

## What ships at end of Phase 2

1. A chunk format (JSON) and an authored library of **40-60 chunks** rated
   difficulty 1–10 across all current obstacle types.
2. A `ChunkPicker` in `sticker-galaxy-sdk-core` that selects the next chunk
   from the library based on `difficultyAt(t)` + the previous chunk's exit
   contract.
3. A `BridgeChunk` system that inserts breathers when no library chunk
   satisfies the entry/exit contract.
4. Swamp Runner's `spawn.ts` rewritten to drive from `ChunkPicker` instead
   of independent per-spawner probabilities.
5. A casual-mode toggle so we can A/B chunks vs IID for one release.

## File-by-file plan

### Layer A — SDK core additions
- `sticker-galaxy-sdk-core/src/chunks/types.ts` — `Chunk`, `ChunkEntity`,
  `LaneState`, `BridgeRule` interfaces (see Architecture doc §2.1).
- `sticker-galaxy-sdk-core/src/chunks/picker.ts` — `ChunkPicker`:
  - Constructor takes `(chunks: Chunk[], rng: SeededRNG)`.
  - `next(currentT_ms, mode, lastExit): Chunk` returns the next chunk.
  - Difficulty bucket: pick from chunks with `|chunk.difficulty - target| ≤ 1`,
    where `target = difficultyAt(t, mode)`.
  - Entry contract: `chunk.entry ∩ lastExit ≠ ∅` or insert a bridge.
- `sticker-galaxy-sdk-core/src/chunks/bridge.ts` — small pre-authored
  bridge library; pick the smallest bridge that satisfies the lane
  shift constraint.
- `sticker-galaxy-sdk-core/src/chunks/curves.ts` — `CASUAL_CURVE`,
  `DAILY_CURVE`, `TOURNEY_CURVE` as piecewise-linear samplers.
- Tests: identical seed produces identical chunk sequence; entry/exit
  contracts always satisfied across 10k random walks of 5min runs;
  no chunk repeats within 4-chunk window (variety guarantee).

### Layer B — Swamp Runner chunk library
- `swamp-runner/src/chunks/library/*.json` — author 40–60 chunks.
- Each chunk is a small JSON with:
  ```json
  {
    "id": "sw_triple_slime_01",
    "difficulty": 3,
    "duration_ms": 2400,
    "tags": ["jump", "ground"],
    "entry": { "lanes": ["ground"] },
    "exit": { "lanes": ["ground"] },
    "entities": [
      { "offset_ms": 0,    "type": "slime", "lane": "ground" },
      { "offset_ms": 800,  "type": "slime", "lane": "ground" },
      { "offset_ms": 1600, "type": "slime", "lane": "ground" },
      { "offset_ms": 2200, "type": "essence", "lane": "air-low" }
    ]
  }
  ```
- Suggested seed library (use this as a starter; author can deviate):

  **Difficulty 1–3 (warmup):**
  - sw_single_slime_low_01
  - sw_single_log_short_01
  - sw_solo_essence_arc_01
  - sw_double_slime_wide_01
  - sw_log_with_essence_01

  **Difficulty 4–6 (mid):**
  - sw_triple_slime_tight_01
  - sw_mynock_dive_basic_01
  - sw_vine_then_slime_01
  - sw_sinking_log_essence_01
  - sw_holocron_apex_window_01
  - sw_branch_garden_low_01
  - sw_log_chain_03
  - sw_slime_vine_combo_01

  **Difficulty 7–8 (hard):**
  - sw_double_vine_mynock_01
  - sw_apex_holocron_into_dive_01
  - sw_slime_floor_lava_01
  - sw_sinking_chain_holocron_01

  **Difficulty 9–10 (expert):**
  - sw_branch_canopy_full_01
  - sw_mynock_swarm_01
  - sw_perfect_run_only_01 (holocron only reachable with apex double-jump)

  **Bibo cameo chunks (rare, marked tag: cameo):**
  - sw_bibo_safe_01
  - sw_bibo_risky_01

### Layer C — Spawn rewrite
- Strip `spawnInterval`, `groundObstacleChance`, `mynockChance`, etc., from
  `swamp-runner/src/game/spawn.ts`. Replace with:
  ```ts
  function maybeSpawn(state: GameState, canvasW: number) {
    while (state.chunkQueueScreenX < canvasW + 80) {
      const chunk = state.chunkPicker.next(state.gameTimeMs, state.mode, state.lastExit);
      lay(state, chunk, state.chunkQueueScreenX);
      state.chunkQueueScreenX += chunk.duration_ms * SCROLL_PX_PER_MS;
      state.lastExit = chunk.exit;
    }
  }
  ```
- `lay()` translates chunk entities into actual `Obstacle` and `Pickup`
  records using the existing spawn helpers (`spawnSlime`, `spawnMynock`,
  etc.). Position = `screenX + entity.offset_ms * SCROLL_PX_PER_MS`.
- Add `state.chunkPicker`, `state.lastExit`, `state.chunkQueueScreenX`
  fields to `GameState`.
- Keep `spawnPickup` for in-chunk essence/holocron; remove the
  independent pickup chance rolls at the bottom of `maybeSpawn`.

### Layer D — Casual mode toggle (one-release safety valve)
- `state.spawnMode: 'iid' | 'chunks'` defaults to `'chunks'`.
- URL param `?legacy=1` falls back to old IID spawner (preserved on a
  branch or in a `spawn-legacy.ts` file).
- Daily Challenge mode is **always** chunks (no fallback).
- One release with the toggle; next release deletes the legacy path.

## Authoring guidance

Each chunk should pass **all** of:
1. **Solo solvability:** the chunk on its own can be cleared with zero hits
   by an average player at its rated difficulty.
2. **Single "intent":** the chunk teaches/demands one technique (jump
   timing, double-jump apex, dive, lane swap, parry, etc.). Mixed-intent
   chunks become bridges, not library entries.
3. **Memorable shape:** if you drew the chunk silhouette in 5 seconds you
   could identify it later. No two chunks should be visually
   indistinguishable.
4. **Score-line dual:** offers a "safe line" (clear obstacles) and a "max
   line" (also grab the optional holocron). Difficulty gap between safe
   and max is the score-skill axis.
5. **No invisible kills:** every obstacle is visible from spawn-x to
   contact-x — no off-screen surprises.

## Composition rules (the always-solvable guarantee)

A chunk picker rule:
```
chunk A → chunk B is valid iff A.exit.lanes ∩ B.entry.lanes ≠ ∅
```

If invalid, insert the smallest `BridgeChunk` from the bridge library that:
- starts in `A.exit.lanes`
- ends in `B.entry.lanes`
- duration ≤ 800ms (otherwise the run loses pace)

Bridges are simple by design: 200-400ms of empty ground + an optional
single essence floater. They feel like "the camera takes a breath."

## Difficulty curves

```ts
// CASUAL: rolls slow then steady at 6
CASUAL_CURVE = [
  { t_ms: 0,      d: 1 },
  { t_ms: 10_000, d: 2 },
  { t_ms: 30_000, d: 4 },
  { t_ms: 60_000, d: 5 },
  { t_ms: 120_000, d: 6 },
  { t_ms: 600_000, d: 6 },
]

// DAILY: same as casual but with a 9 spike at the end (encourages PB-chasing)
DAILY_CURVE = [
  { t_ms: 0,      d: 1 },
  { t_ms: 30_000, d: 4 },
  { t_ms: 90_000, d: 7 },
  { t_ms: 180_000, d: 9 },
  { t_ms: 600_000, d: 9 },
]

// TOURNEY: hard ramp, no slack
TOURNEY_CURVE = [
  { t_ms: 0,      d: 3 },
  { t_ms: 20_000, d: 6 },
  { t_ms: 45_000, d: 8 },
  { t_ms: 75_000, d: 10 },
  { t_ms: 600_000, d: 10 },
]
```

Sample linearly between breakpoints. Picker uses `floor(sample(t))` as
target difficulty and picks from `[target-1, target+1]` bucket.

## What does NOT ship in Phase 2

- Backend `/replay` verification (Phase 3)
- Daily seed published from `/session` (Phase 3 — currently derived
  client-side from UTC date, which is fine for solo daily but not for
  tournament integrity)
- Tech-ceiling mechanics: mosswalk, late-jump tax, holocron streak (Phase 4)
- Head-to-head race (Phase 5)

## Acceptance criteria

1. `npx tsc --noEmit` clean on `sticker-galaxy-sdk-core` and `swamp-runner`.
2. SDK core tests pass including the 10k-run-chain entry/exit contract test.
3. Two cold loads of `?mode=daily` produce identical visible chunk
   sequences for the first 60 seconds.
4. Casual mode (default chunks) plays without obvious gaps, pile-ups, or
   unsolvable spawns through 5 minutes of test runs.
5. `?legacy=1` falls back to IID spawner.
6. Game-over screen still works; ghost run still overlays correctly.
7. No regressions in TON/YODA payment flow.

## Time estimate

- SDK core changes: ~half day
- Chunk authoring (40–60 chunks): 2 days (this is the long pole)
- Spawn rewrite + integration: half day
- Playtest + tuning + difficulty rebalance: 1 day

Total: 3–4 working days.
