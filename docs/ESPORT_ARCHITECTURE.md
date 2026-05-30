# Esport-grade Architecture for Sticker Galaxy Minigames

**Thesis:** A game is only an esport when **skill > luck** is provable across
runs. The current Swamp Runner spawner (independent per-tick probabilities
per lane) makes every run a different level. You cannot speedrun, optimize,
or memorize randomness. Whoever rolled the easiest 90 seconds wins.

This doc covers the canonical pattern used by every actually-competitive
endless/runner/rhythm/precision game and how to apply it to Sticker Galaxy
generically (not just Swamp Runner).

---

## 1. The five-layer esport stack

| Layer | Question it answers | Examples |
|---|---|---|
| 1. Determinism | Same input → same level? | Geometry Dash, Trackmania, Tetris (TGM), OSU! |
| 2. Hand-authored chunks | Are difficulty units designed, not rolled? | Celeste rooms, GD blocks, Trials sections |
| 3. Composition rules | How chunks connect into a run | Slay the Spire / Spelunky chunk graph |
| 4. Difficulty curve | Skill ramps fairly with time | Tetris gravity table, GD BPM ramp |
| 5. Replay + verification | Score is provable, not claimed | Speedrun.com, GD coin verification, Tetris.io PPS replay |

Skip any layer and the leaderboard becomes social-media-tier, not esport-tier.

---

## 2. Pattern-chunk system

Replace per-tick `Math.random() < spawnRate` with a stream of hand-authored
**chunks** stitched by a deterministic PRNG seeded per-run.

### 2.1 Chunk shape

```ts
interface Chunk {
  id: string;                  // 'sw_log_jump_basic_01'
  game: 'swamp_runner' | ...;
  duration_ms: number;         // playthrough length (e.g. 2200)
  difficulty: number;          // 1..10, hand-rated
  tags: Tag[];                 // ['jump', 'slide', 'lane-change']
  entry: LaneState;            // which lane(s) player must enter from
  exit: LaneState;             // which lanes are safe to leave in
  entities: ChunkEntity[];     // (offset_ms, lane, type, params)
  variants?: number;           // mirror, lane-shift, etc.
}
```

### 2.2 Authoring vs rolling

- **Bottom 60%** of a run: hand-authored chunks ordered by difficulty curve.
- **Top 40%**: procedural composition of chunk fragments under hard
  playability rules.
- Casual mode: fresh seed each run. Tournament modes: fixed seed.

### 2.3 Difficulty curve

```ts
function difficultyAt(t_ms: number, mode: Mode): number {
  if (mode === 'daily')   return DAILY_CURVE.sample(t_ms);
  if (mode === 'tourney') return TOURNEY_CURVE.sample(t_ms);
  return CASUAL_CURVE.sample(t_ms);
}
```

Chunk picker queries `difficultyAt(t)` and picks from a weighted bucket
matching ±1. This is how Geometry Dash feels linearly ramping despite
being modular.

### 2.4 Composition rules

`A` → `B` valid iff `A.exit ∩ B.entry ≠ ∅`. Otherwise insert a **bridge
chunk** (400–800ms breather that lane-shifts cleanly). Same graph-walk
Spelunky uses for room generation. Result: no impossible spawns, ever.

---

## 3. Determinism stack

The actual separator between "endless runner" and "Tetris."

### 3.1 Seeded PRNG everywhere

```ts
class SeededRNG {
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { /* mulberry32 or xoshiro128** */ }
}
```

**Every** random call reads from `gameState.rng`. Zero `Math.random`,
zero `Date.now()` in spawn decisions or physics.

### 3.2 Fixed-timestep simulation

Phaser's default variable timestep breaks determinism. For esport mode:

```ts
scene.physics.world.fixedStep = true;
scene.physics.world.fps = 60;
// drive update from accumulator, not delta
```

All entity motion in integer "tick" units.

### 3.3 Input recording

```ts
interface InputEvent { tick: number; type: 'jump' | 'slide' | ...; }
const replay: InputEvent[] = [];
```

A run = `{ seed, mode, build_hash, inputs: InputEvent[] }`. Server replays
through the same engine and verifies the score. Kills client-side cheating
without anti-cheat snake oil. GD, OSU!, StepMania all do this.

### 3.4 Build hash gate

Server only accepts replays from `build_hash` it knows. Physics-altering
hotfix? Old leaderboards tag with old hash. Same pattern as
Speedrun.com's category-rules.

---

## 4. Tournament modes

### 4.1 Daily Seed
- One seed per day, same for every player
- 24h window, best score wins, UTC midnight reset
- **Alone** this takes Sticker Galaxy from casual to competitive

### 4.2 Weekly Tournament
- 7 fixed seeds, players play each once, sum of scores
- Seed variance averages out

### 4.3 Head-to-head race
- Two players identical seed, simultaneous
- Winner = first to X score or last alive
- The real esport unlock — spectatable, bracketable

### 4.4 Pro Mode
- No IAP revives/extras affect leaderboard score
- Locked input mapping
- Pro Mode runs eligible for global leaderboard; casual is side-only

---

## 5. Skill-expression mechanics

Determinism is necessary but not sufficient. The game must reward mastery.

### 5.1 Tech ceiling layers (ordered by value)

| Layer | Mechanic | Reference |
|---|---|---|
| 1 | Precision input window — frame-perfect timing | OSU! 16ms |
| 2 | Movement tech — non-obvious optimal lines | GD wave/ship/robot |
| 3 | Risk/reward layering — optional hard pickups | Subway Surfers coin lines, but punishing |
| 4 | Combo / multiplier — chains break on miss, exponential | Tetris T-spin, GD coins |
| 5 | Read-ahead skill — plan 2-3 chunks ahead | Tetris next queue |

Each ~200 hours of skill ceiling. Three layers = real esport.

### 5.2 Swamp Runner specific tech

- **Mosswalk**: hold jump on landing → tiny speed boost (frame-perfect)
- **Holocron streak**: consecutive holocrons within Xms multiply, miss resets
- **Late-jump tax / early-jump bonus**: timing window inside the timing window
- **Slime parry**: slide through a slime at exact frame → damage buff next obstacle
- **Lane-cancel**: lane change within 100ms of jump → tighter arc, opens diagonals

Each invisible to casual players, devastating in expert hands.

### 5.3 Anti-luck rules

- Pickup positions are part of chunk authoring, not random
- Difficulty curve is deterministic, no random spikes
- Revives cost score (e.g. -30%), not pay-or-die
- Defeat is deterministic — no rubber-banding, no per-run health rolls

---

## 6. Replay + spectator

| Feature | Impact | Cost |
|---|---|---|
| `.sgr` replay file | Verifiable scores | Low |
| Share-to-Telegram replay GIF | Viral loop | Medium |
| Live spectator (race) | Real esport | High |
| Ghost run | Self-improvement loop | Low |
| Top-10 ghost on daily | Social pressure | Low |

Ghost run alone (your PB transparent overlay) is a 5x retention move.
Trackmania built its empire on this.

---

## 7. Generalization across Sticker Galaxy

Shared esport core:

```
sticker-galaxy-esport-core/
├── prng.ts            // seeded PRNG, same across all games
├── fixed-step.ts      // deterministic Phaser config
├── replay.ts          // record/playback/verify
├── chunks/            // per-game chunk authoring
│   ├── swamp_runner/
│   └── future_game_2/
├── modes.ts           // casual / daily / weekly / tournament / pro
└── leaderboard.ts     // signed replay submission
```

Every new minigame inherits esport-tier infrastructure for free. New game
just ships: chunks + difficulty curve + tech mechanics.

Backend (`babyyoda-bot`) needs one new table:

```sql
CREATE TABLE arcade_replays (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  mode TEXT NOT NULL,             -- 'casual' | 'daily' | ...
  seed BIGINT NOT NULL,
  build_hash TEXT NOT NULL,
  input_log BLOB NOT NULL,        -- compressed
  reported_score INTEGER NOT NULL,
  verified_score INTEGER,         -- NULL until worker validates
  status TEXT NOT NULL,           -- 'pending' | 'verified' | 'rejected'
  created_at INTEGER NOT NULL
);
```

Verification worker runs replay through headless build (node-canvas or
pure logic) and signs off.

---

## 8. SOTA reference table

| Game | Steal | Apply via |
|---|---|---|
| Tetris (TGM / Tetris.io) | Deterministic 60Hz tick + replay verify + gravity table | Fixed-step Phaser + input log |
| Geometry Dash | Hand-authored level segments, BPM-locked difficulty | Chunk authoring + curve |
| Celeste | Hand-built rooms with exit/entry contracts | Chunk graph composition |
| Trackmania | Daily/weekly identical-track leaderboards, ghost runs | Daily seed + ghost overlay |
| OSU! | Replay file format, server-side verify, build hash gate | Replay + signed submission |
| Spelunky | Procedural rooms with always-playable guarantees | Composition rules + bridges |
| Trials Rising | Authored sections within procedural shell | Authored + procedural blend |

---

## 9. Phased rollout for Swamp Runner

### Phase 1 — Determinism (1–2 days)
- Seeded PRNG everywhere
- Fixed-step physics
- Input log + replay storage (client-only)
- Ship as opt-in **Ghost Run** — proves determinism works

### Phase 2 — Chunks (3–5 days)
- Build chunk authoring format (JSON)
- Author 40–60 starter chunks across difficulty 1–10
- Replace independent spawners with chunk picker
- Composition rules + bridge chunks
- Ship as "v2 levels"; old mode stays as fallback for one release

### Phase 3 — Tournament (2–3 days)
- Backend replay table + verify worker
- Daily Seed mode in UI
- Build hash gating
- Ship as "Daily Challenge"

### Phase 4 — Tech ceiling (ongoing)
- Mosswalk, late-jump tax, holocron streak, parry
- Each A/B'd against retention

### Phase 5 — Head-to-head (1–2 weeks)
- Lobby + matchmaking + simultaneous race
- WebRTC spectator
- $YODA prize pool tournaments

---

## 10. Decision required

**Option A — Determinism-first** (recommended)
- Phase 1 only, ship Ghost Run
- 1–2 days work, lowest risk, immediate user-visible value
- Unlocks every later phase

**Option B — Chunk-first**
- Phase 1 + 2, ship "v2 levels"
- 1 week, gameplay feels different immediately

**Option C — Full Daily Challenge**
- Phase 1 + 2 + 3, ship the actual feature
- 2 weeks, real test of "does anyone care about competitive Swamp Runner"

**Pick:** A first. Ghost Run validates whether the audience wants
competitive features. If retention spikes when people see their PB next
to them, phases B and C are obviously worth it. If not, two days spent
instead of two weeks.

---

## 11. Anti-patterns

- **Don't** ship determinism as a toggle behind casual default. Make
  Daily Challenge the front door.
- **Don't** verify scores client-side. Replay verifier is authoritative
  on the backend.
- **Don't** let $YODA revives/extras affect tournament scores. Pro Mode
  = zero IAP impact, period.
- **Don't** retrofit determinism into the existing scene class. Build
  esport core as a separate module and have minigames adopt it.
- **Don't** author chunks in code. Build the JSON format day one or you'll
  regret it at chunk #30.
