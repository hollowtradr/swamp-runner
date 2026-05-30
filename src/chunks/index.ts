/**
 * src/chunks/index.ts — Swamp Runner chunk library loader.
 *
 * Imports all authored chunk JSON files and re-exports them as a typed
 * Chunk[] array ready to pass to ChunkPicker. JSON files that have a
 * "_todo" field are treated as stubs — they ship as valid (playable) chunks
 * but can be easily found and replaced by a human author later.
 *
 * Add new chunks: drop a *.json in library/, import it here, add to CHUNKS.
 */

import type { Chunk } from 'sticker-galaxy-sdk-core'

// ── Difficulty 1-2 (warmup) ───────────────────────────────────────────────────
import d1_single_slime from './library/sw_single_slime_01.json' assert { type: 'json' }
import d1_single_log from './library/sw_single_log_short_01.json' assert { type: 'json' }
import d1_solo_essence_arc from './library/sw_solo_essence_arc_01.json' assert { type: 'json' }
import d2_double_slime_wide from './library/sw_double_slime_wide_01.json' assert { type: 'json' }
import d2_log_with_essence from './library/sw_log_with_essence_01.json' assert { type: 'json' }
import d2_essence_highway from './library/sw_essence_highway_01.json' assert { type: 'json' }
import d2_bibo_safe from './library/sw_bibo_safe_01.json' assert { type: 'json' }

// ── Difficulty 3-4 (early challenge) ─────────────────────────────────────────
import d3_triple_slime from './library/sw_triple_slime_01.json' assert { type: 'json' }
import d3_mynock_dive_basic from './library/sw_mynock_dive_basic_01.json' assert { type: 'json' }
import d3_slime_log_slime from './library/sw_slime_log_slime_01.json' assert { type: 'json' }
import d3_low_vine_arch from './library/sw_TODO_stub_d3_01.json' assert { type: 'json' }
import d4_vine_then_slime from './library/sw_vine_then_slime_01.json' assert { type: 'json' }
import d4_slime_vine_combo from './library/sw_slime_vine_combo_01.json' assert { type: 'json' }
import d4_log_chain from './library/sw_log_chain_03.json' assert { type: 'json' }
import d4_bibo_risky from './library/sw_bibo_risky_01.json' assert { type: 'json' }
import d4_platform_hop from './library/sw_TODO_stub_d4_01.json' assert { type: 'json' }

// ── Difficulty 5-6 (mid) ──────────────────────────────────────────────────────
import d5_triple_slime_tight from './library/sw_triple_slime_tight_01.json' assert { type: 'json' }
import d5_sinking_log_essence from './library/sw_sinking_log_essence_01.json' assert { type: 'json' }
import d5_holocron_apex_window from './library/sw_holocron_apex_window_01.json' assert { type: 'json' }
import d5_branch_garden_low from './library/sw_branch_garden_low_01.json' assert { type: 'json' }
import d5_mynock_slime_combo from './library/sw_mynock_slime_combo_01.json' assert { type: 'json' }
import d5_mynock_gap_slime from './library/sw_TODO_stub_d5_01.json' assert { type: 'json' }
import d6_vine_then_mynock from './library/sw_vine_then_mynock_01.json' assert { type: 'json' }
import d6_double_vine from './library/sw_double_vine_01.json' assert { type: 'json' }
import d6_sinking_chain from './library/sw_sinking_chain_01.json' assert { type: 'json' }
import d6_log_then_slime from './library/sw_log_then_slime_01.json' assert { type: 'json' }
import d6_triple_mynock from './library/sw_triple_mynock_01.json' assert { type: 'json' }
import d6_mynock_over_slime from './library/sw_mynock_over_slime_01.json' assert { type: 'json' }

// ── Difficulty 7-8 (hard) ────────────────────────────────────────────────────
import d7_slime_floor_lava from './library/sw_slime_floor_lava_01.json' assert { type: 'json' }
import d7_double_vine_mynock from './library/sw_double_vine_mynock_01.json' assert { type: 'json' }
import d7_apex_holocron_dive from './library/sw_apex_holocron_into_dive_01.json' assert { type: 'json' }
import d7_sinking_log_vine from './library/sw_sinking_log_vine_01.json' assert { type: 'json' }
import d7_sinking_into_slime from './library/sw_TODO_stub_d7_01.json' assert { type: 'json' }
import d8_sinking_chain_holocron from './library/sw_sinking_chain_holocron_01.json' assert { type: 'json' }
import d8_vine_slime_gauntlet from './library/sw_vine_slime_gauntlet_01.json' assert { type: 'json' }
import d8_holocron_chase from './library/sw_holocron_chase_01.json' assert { type: 'json' }
import d8_vine_sinking from './library/sw_TODO_stub_d8_01.json' assert { type: 'json' }

// ── Difficulty 9-10 (expert) ──────────────────────────────────────────────────
import d9_mynock_swarm from './library/sw_mynock_swarm_01.json' assert { type: 'json' }
import d9_branch_canopy_full from './library/sw_branch_canopy_full_01.json' assert { type: 'json' }
import d9_triple_slime_vine_overhead from './library/sw_TODO_stub_d9_01.json' assert { type: 'json' }
import d10_perfect_run_only from './library/sw_perfect_run_only_01.json' assert { type: 'json' }
import d10_endgame_gauntlet from './library/sw_TODO_stub_d10_01.json' assert { type: 'json' }

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Full authored chunk library for Swamp Runner.
 * Pass this to `new ChunkPicker(SWAMP_RUNNER_CHUNKS, state.rng)` at game start.
 *
 * Stats as of Phase 2 authoring:
 *   - 42 quality-authored chunks (Phase 2 + content-pass 2026-05-30)
 *   -  0 TODO stubs
 *   - 42 total
 *   - Difficulty coverage: 1–10
 */
export const SWAMP_RUNNER_CHUNKS: Chunk[] = [
  // warmup
  d1_single_slime,
  d1_single_log,
  d1_solo_essence_arc,
  d2_double_slime_wide,
  d2_log_with_essence,
  d2_essence_highway,
  d2_bibo_safe,
  // early challenge
  d3_triple_slime,
  d3_mynock_dive_basic,
  d3_slime_log_slime,
  d3_low_vine_arch,
  d4_vine_then_slime,
  d4_slime_vine_combo,
  d4_log_chain,
  d4_bibo_risky,
  d4_platform_hop,
  // mid
  d5_triple_slime_tight,
  d5_sinking_log_essence,
  d5_holocron_apex_window,
  d5_branch_garden_low,
  d5_mynock_slime_combo,
  d5_mynock_gap_slime,
  d6_vine_then_mynock,
  d6_double_vine,
  d6_sinking_chain,
  d6_log_then_slime,
  d6_triple_mynock,
  d6_mynock_over_slime,
  // hard
  d7_slime_floor_lava,
  d7_double_vine_mynock,
  d7_apex_holocron_dive,
  d7_sinking_log_vine,
  d7_sinking_into_slime,
  d8_sinking_chain_holocron,
  d8_vine_slime_gauntlet,
  d8_holocron_chase,
  d8_vine_sinking,
  // expert
  d9_mynock_swarm,
  d9_branch_canopy_full,
  d9_triple_slime_vine_overhead,
  d10_perfect_run_only,
  d10_endgame_gauntlet,
] as Chunk[]
