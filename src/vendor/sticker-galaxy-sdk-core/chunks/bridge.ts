/**
 * src/chunks/bridge.ts — Bridge chunk library.
 *
 * Bridge chunks are short (200–800ms) gap-fillers inserted by ChunkPicker
 * when no library chunk satisfies the entry/exit contract.
 * Simple by design: a breath of empty ground + an optional essence floater.
 * "The camera takes a breath."
 */

import type { BridgeChunk } from './types.js'

export const BRIDGE_CHUNKS: BridgeChunk[] = [
  // ── Ground → ground (plain breather) ─────────────────────────────────────
  {
    id: 'bridge_gnd_gnd_01',
    game: 'swamp_runner',
    difficulty: 1,
    duration_ms: 400,
    tags: ['bridge'],
    entry: { lanes: ['ground'] },
    exit:  { lanes: ['ground'] },
    entities: [],
    from: ['ground'],
    to:   ['ground'],
  },
  // ── Ground → ground (with floater reward) ────────────────────────────────
  {
    id: 'bridge_gnd_gnd_02',
    game: 'swamp_runner',
    difficulty: 1,
    duration_ms: 600,
    tags: ['bridge'],
    entry: { lanes: ['ground'] },
    exit:  { lanes: ['ground'] },
    entities: [
      { offset_ms: 300, type: 'essence', lane: 'air-low' },
    ],
    from: ['ground'],
    to:   ['ground'],
  },
  // ── Platform/ground → ground (land-down breather) ────────────────────────
  {
    id: 'bridge_plat_gnd_01',
    game: 'swamp_runner',
    difficulty: 1,
    duration_ms: 500,
    tags: ['bridge'],
    entry: { lanes: ['platform', 'ground'] },
    exit:  { lanes: ['ground'] },
    entities: [],
    from: ['platform'],
    to:   ['ground'],
  },
  // ── Ground → platform (bridge into platform chunk) ───────────────────────
  {
    id: 'bridge_gnd_plat_01',
    game: 'swamp_runner',
    difficulty: 2,
    duration_ms: 600,
    tags: ['bridge'],
    entry: { lanes: ['ground'] },
    exit:  { lanes: ['platform', 'ground'] },
    entities: [
      { offset_ms: 200, type: 'log', lane: 'platform' },
    ],
    from: ['ground'],
    to:   ['platform'],
  },
  // ── Universal → ground (any lane, 800ms max, wraps anything) ─────────────
  {
    id: 'bridge_any_gnd_01',
    game: 'swamp_runner',
    difficulty: 1,
    duration_ms: 800,
    tags: ['bridge'],
    entry: { lanes: ['ground', 'air-low', 'air-high', 'platform'] },
    exit:  { lanes: ['ground'] },
    entities: [
      { offset_ms: 400, type: 'essence', lane: 'air-low' },
    ],
    from: ['ground', 'air-low', 'air-high', 'platform'],
    to:   ['ground'],
  },
]
