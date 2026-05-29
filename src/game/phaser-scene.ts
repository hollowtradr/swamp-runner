/**
 * src/game/phaser-scene.ts — Phaser 3 scene for Swamp Runner
 *
 * Replaces render.ts. Owns all rendering via Phaser Graphics objects
 * (cleared + redrawn each frame). Physics still run through the existing
 * state.ts / physics.ts / spawn.ts pipeline — Phaser is the renderer only.
 *
 * Key improvements over the Canvas2D version:
 *  1. HUD overlap FIXED: banner renders at 40% screen height (always below score card)
 *  2. Player scales 1.5× with idle bob + jump tilt Phaser tweens
 *  3. Obstacles use high-contrast shapes with thick outlines (visible vs background)
 *  4. Biome tint shifts every 500 paces: day → twilight → day (smooth lerp)
 *  5. ParticleEmitter for ambient spores + firefly trails
 */

import Phaser from 'phaser'
import {
  type GameState,
  type Obstacle,
  type Pickup,
  type Platform,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
} from './state.js'
import { updatePhysics, startJump, releaseJump } from './physics.js'
import { tgHaptic } from '../tg.js'

// ── Types ─────────────────────────────────────────────────────────────────────

type GameEndCallback = (score: number, outcome: 'win' | 'loss') => void

interface SceneInitData {
  state: GameState
  onEnd: GameEndCallback
}

// ── Biome colour palettes ─────────────────────────────────────────────────────

const DAY = {
  skyTop: 0xc8d898, skyMid: 0x7aaa58, skyLow: 0x3a6a2a,
  bgTree: 0x2a5a28, fgTree: 0x1a4a1a,
  groundTop: 0x5a8a38, groundBot: 0x3a6a28,
  waterTop: 0x3a7a48, waterBot: 0x1a4a28,
  grass: 0x4a7a28,
}
const TWIL = {
  skyTop: 0x8855aa, skyMid: 0x5a3a7a, skyLow: 0x2a1a3a,
  bgTree: 0x1a1a3a, fgTree: 0x0d0d22,
  groundTop: 0x3a5a28, groundBot: 0x1a3a18,
  waterTop: 0x1a2a3a, waterBot: 0x0d1a22,
  grass: 0x2a4a18,
}

function lerp(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  return ((Math.round(ar + (br - ar) * t) << 16) |
          (Math.round(ag + (bg - ag) * t) << 8) |
           Math.round(ab + (bb - ab) * t))
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export class SwampScene extends Phaser.Scene {
  // State references
  private gs!: GameState
  // @ts-ignore — held for future restart-on-game-over flows
  private onEndCb!: GameEndCallback

  // Graphics layers (cleared + redrawn every frame)
  private bgGfx!: Phaser.GameObjects.Graphics
  private groundGfx!: Phaser.GameObjects.Graphics
  private entityGfx!: Phaser.GameObjects.Graphics
  private playerGfx!: Phaser.GameObjects.Graphics
  private hudGfx!: Phaser.GameObjects.Graphics

  // Player sprite (loaded if /sprites/ exist, else drawn via playerGfx)
  private playerImg: Phaser.GameObjects.Image | null = null

  // Tween state
  private bobTween: Phaser.Tweens.Tween | null = null
  private bobOffset = 0  // driven by tween
  private prevAnim = 'running'
  private gameEndFired = false

  // Run animation
  private runTimer = 0

  // Biome state
  private biomeTint = 0       // 0=day, 1=twilight (interpolated)
  private biomeTarget = 0
  private lastBiomeZone = 0

  // HUD text objects (persistent Phaser Text nodes)
  // @ts-ignore — kept to mirror layout; HUD label may be re-enabled in v2
  private scoreLabel!: Phaser.GameObjects.Text
  private scoreValue!: Phaser.GameObjects.Text
  private timeText!: Phaser.GameObjects.Text
  private bannerText!: Phaser.GameObjects.Text
  private boostText!: Phaser.GameObjects.Text

  // Pre-generated tree positions (deterministic, stays stable between frames)
  private readonly bgTrees = Array.from({ length: 12 }, (_, i) => ({
    nx: i / 12 + 0.04, nh: 0.25 + (i * 0.137 % 0.15), nw: 0.04 + (i * 0.079 % 0.03),
  }))
  private readonly fgTrees = Array.from({ length: 8 }, (_, i) => ({
    nx: i / 8 + 0.02, nh: 0.12 + (i * 0.113 % 0.08), nw: 0.055 + (i * 0.067 % 0.025),
  }))

  // V2 painted tree sprites (Stage 2): pooled, positioned by world offset
  private treeFarSprites: Phaser.GameObjects.Image[] = []
  private treeMidSprites: Phaser.GameObjects.Image[] = []
  private treeNearSprites: Phaser.GameObjects.Image[] = []
  /** Foreground foliage silhouettes (Silksong-style). Depth 3.5 so they sit
   *  in front of the player, creating parallax-bokeh framing. */
  private fgFoliage: Phaser.GameObjects.Image[] = []

  // V2 painted obstacle / pickup sprite pools
  private obstaclePool: Map<string, Phaser.GameObjects.Image[]> = new Map()

  // V2 painted ground tile sprite (legacy, only used if v5 plates missing)
  private groundTile: Phaser.GameObjects.TileSprite | null = null

  // v5/v6 painterly scene plates. v6 adds a true backdrop (bg_sky) underneath
  // cutout overlays (canopy/mid/ground) for proper parallax depth. When v6
  // plates exist we use them; v5 is the fallback path. Player snaps to the
  // ground plate's walk line in both cases.
  private plateSky: Phaser.GameObjects.TileSprite | null = null
  private plateCanopy: Phaser.GameObjects.TileSprite | null = null
  private plateMid: Phaser.GameObjects.TileSprite | null = null
  private plateGround: Phaser.GameObjects.TileSprite | null = null

  /** True once preload found all three v5 plates. */
  private hasV5Plates = false
  /** True once preload found all four v6 plates (sky + 3 cutouts). */
  private hasV6Plates = false

  /** Y where the ground-plate's walk line sits in screen coords. Reserved
   *  for future use to snap player feet to the painted plate's walk line. */
  // @ts-expect-error  unused for now; will drive player anchor in next pass
  private v5GroundLineY = 0

  constructor() { super({ key: 'SwampScene' }) }

  // ── Phaser lifecycle ──────────────────────────────────────────────────────

  init(data: SceneInitData): void {
    this.gs = data.state
    this.onEndCb = data.onEnd
    this.gameEndFired = false
    this.biomeTint = 0; this.biomeTarget = 0; this.lastBiomeZone = 0
    this.prevAnim = 'running'; this.bobOffset = 0
  }

  /**
   * Called by reviveGame() in game/index.ts after the state-level revive.
   * Clears the one-shot gameEnd guard so the next death emits cleanly.
   */
  resetForRevive(): void {
    this.gameEndFired = false
  }

  preload(): void {
    // Silence 404s for missing sprites gracefully
    this.load.on('loaderror', (_file: unknown) => { /* ignore */ })
    // Original Egor-style v1 sprites
    this.load.image('yoda_idle',   '/sprites/v4/yoda_idle_v4.png')
    this.load.image('yoda_idle_b', '/sprites/v4/yoda_idle_b_v4.png')
    // V2 painted assets (Stage 2 — Gemini-generated, Egor-style)
    this.load.image('yoda_jump',   '/sprites/v4/yoda_jump_v4.png')
    this.load.image('yoda_hit',    '/sprites/v4/yoda_hit_v4.png')
    this.load.image('yoda_defeat', '/sprites/v4/yoda_defeat_v4.png')
    this.load.image('log_v2',      '/sprites/v4/log_v4.png')
    this.load.image('log_sink_v2', '/sprites/v4/log_sinking_v4.png')
    this.load.image('slime_v2',    '/sprites/v4/slime_v4.png')
    this.load.image('vine_v2',     '/sprites/v4/vine_v4.png')
    this.load.image('mynock_v2',   '/sprites/v4/mynock_v4.png')
    this.load.image('bibo_v2',     '/sprites/v4/bibo_v4.png')
    this.load.image('holocron_v2', '/sprites/v4/holocron_v4.png')
    this.load.image('mote_v2',     '/sprites/v4/mote_v4.png')
    this.load.image('tree_far_v2', '/sprites/v4/tree_far_v4.png')
    this.load.image('tree_mid_v2', '/sprites/v4/tree_mid_v4.png')
    this.load.image('tree_near_v2','/sprites/v4/tree_near_v4.png')
    this.load.image('mushroom_v2', '/sprites/v4/mushroom_v4.png')
    this.load.image('reed_v2',     '/sprites/v2/reed_v2.png')
    this.load.image('ground_v2',   '/sprites/v4/ground_v4.png')
    // v5 painterly scene plates (Silksong/Ghibli style). Three horizontally-
    // tiling sprite scrollers replace the old procedural sky+trees+ground.
    this.load.image('plate_canopy', '/sprites/v5/bg_canopy.jpg')
    this.load.image('plate_mid',    '/sprites/v5/bg_mid_trees.jpg')
    this.load.image('plate_ground', '/sprites/v5/bg_ground.png')
    // v6 painterly redesign — one opaque sky backdrop + three transparent
    // cutout overlays. True parallax depth instead of three stacked paintings.
    this.load.image('plate6_sky',    '/sprites/v6/bg_sky.jpg')
    this.load.image('plate6_canopy', '/sprites/v6/bg_canopy.png')
    this.load.image('plate6_mid',    '/sprites/v6/bg_mid_trees.png')
    this.load.image('plate6_ground', '/sprites/v6/bg_ground.png')
  }

  create(): void {
    const { width: w, height: h } = this.scale

    // Graphics layers (back-to-front ordering via depth)
    this.bgGfx     = this.add.graphics().setDepth(0)
    this.groundGfx = this.add.graphics().setDepth(1)
    this.entityGfx = this.add.graphics().setDepth(2)
    this.playerGfx = this.add.graphics().setDepth(4)
    this.hudGfx    = this.add.graphics().setDepth(5)

    // Player sprite (if assets loaded)
    if (this.textures.exists('yoda_idle')) {
      this.playerImg = this.add.image(0, 0, 'yoda_idle')
        .setOrigin(0, 0)
        .setDisplaySize(PLAYER_WIDTH * 1.4, PLAYER_HEIGHT * 1.4)
        .setDepth(3)
        .setVisible(false)
    }

    // ── Particle texture: glowing dot ─────────────────────────────────────
    const ptg = this.make.graphics()
    ptg.fillStyle(0xffffff, 1)
    ptg.fillCircle(4, 4, 4)
    ptg.generateTexture('glow_pt', 8, 8)
    ptg.destroy()

    // Spore ambient emitter (depth 0.5 = behind trees)
    this.add.particles(0, 0, 'glow_pt', {
      x: { min: 0, max: w },
      y: { min: 20, max: Math.round(h * 0.65) },
      speedX: { min: -65, max: -15 },
      speedY: { min: -8, max: 8 },
      scale: { start: 0.38, end: 0 },
      alpha: { start: 0.45, end: 0 },
      tint: [0x88ff88, 0xaaffaa, 0xddffaa, 0xaaffdd],
      lifespan: 3500,
      frequency: 230,
      quantity: 1,
    }).setDepth(0.5)

    // Firefly emitter
    this.add.particles(0, 0, 'glow_pt', {
      x: { min: 0, max: w },
      y: { min: Math.round(h * 0.25), max: Math.round(h * 0.65) },
      speedX: { min: -18, max: 18 },
      speedY: { min: -12, max: 12 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.88, end: 0 },
      tint: [0x88ff44, 0xaaff88, 0xffff44, 0xaaffcc],
      lifespan: 1800,
      frequency: 480,
      quantity: 1,
    }).setDepth(0.5)

    // ── HUD text objects ─────────────────────────────────────────────────
    const td = 6
    this.scoreLabel = this.add.text(20, 16, 'FORCE-PACES', {
      fontSize: '9px',
      fontFamily: "'Cinzel Decorative', Georgia, serif",
      color: '#8a5a10',
    }).setDepth(td)

    this.scoreValue = this.add.text(20, 28, '0', {
      fontSize: '22px',
      fontFamily: "'Cinzel Decorative', Georgia, serif",
      color: '#3a1a00',
      fontStyle: 'bold',
    }).setDepth(td)

    this.timeText = this.add.text(w - 14, 16, '0:00', {
      fontSize: '11px',
      fontFamily: 'Fraunces, Georgia, serif',
      color: '#c8dcc8',
    }).setDepth(td).setOrigin(1, 0)

    // Banner: positioned at 40% screen height so it never overlaps the score card
    this.bannerText = this.add.text(w / 2, h * 0.40, '', {
      fontSize: '14px',
      fontFamily: "'IM Fell English', Georgia, serif",
      fontStyle: 'italic',
      color: '#5a3a0a',
      align: 'center',
      wordWrap: { width: 300 },
    }).setDepth(td).setOrigin(0.5, 0.5).setVisible(false)

    this.boostText = this.add.text(w / 2, 76, 'FORCE SPEED', {
      fontSize: '9px',
      fontFamily: "'Cinzel Decorative', Georgia, serif",
      color: '#c8e6ff',
    }).setDepth(td).setOrigin(0.5, 0).setVisible(false)

    // ── Input ────────────────────────────────────────────────────────────
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      try { (ptr.event as PointerEvent).preventDefault() } catch (_) {}
      startJump(this.gs)
      tgHaptic('impact_light')
    })
    this.input.on('pointerup',  () => releaseJump(this.gs))
    this.input.on('pointerout', () => releaseJump(this.gs))

    // ── Resize ───────────────────────────────────────────────────────────
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.gs.groundY = Math.round(size.height * 0.74)
      this.timeText?.setPosition(size.width - 14, 16)
      this.bannerText?.setPosition(size.width / 2, size.height * 0.40)
    })

    this.gs.groundY = Math.round(h * 0.74)

    // v5 painterly plates — three POT (2048×1024) horizontally-scrolling
    // tile-sprites replace all procedural sky/tree/ground/foliage layers.
    // Depth order: canopy (0) → mid trees (0.5) → ground band (1.0) →
    // entities (2) → player (3). Player walks ON the ground band's painted
    // top edge at `visualGroundY`.
    this.hasV6Plates =
      this.textures.exists('plate6_sky') &&
      this.textures.exists('plate6_canopy') &&
      this.textures.exists('plate6_mid') &&
      this.textures.exists('plate6_ground')
    this.hasV5Plates =
      !this.hasV6Plates &&
      this.textures.exists('plate_canopy') &&
      this.textures.exists('plate_mid') &&
      this.textures.exists('plate_ground')
    console.log('[plates]', {
      v6: {
        sky: this.textures.exists('plate6_sky'),
        canopy: this.textures.exists('plate6_canopy'),
        mid: this.textures.exists('plate6_mid'),
        ground: this.textures.exists('plate6_ground'),
        hasV6: this.hasV6Plates,
      },
      v5: { hasV5: this.hasV5Plates },
    })

    if (this.hasV6Plates) {
      // v6: ONE backdrop + cutout overlays. Sky fills the screen as the
      // deepest layer; canopy/mid/ground are transparent PNGs composited on
      // top at different parallax rates.
      const skySrc = this.textures.get('plate6_sky').getSourceImage() as HTMLImageElement
      this.plateSky = this.add.tileSprite(0, 0, w, h, 'plate6_sky')
        .setOrigin(0, 0)
        .setDepth(-1.0)
      this.plateSky.tileScaleY = h / skySrc.height
      this.plateSky.tileScaleX = h / skySrc.height

      // CANOPY overlay — hanging vines at top of frame. Fills screen so the
      // vines sit in the upper third where they were painted.
      const canopySrc6 = this.textures.get('plate6_canopy').getSourceImage() as HTMLImageElement
      this.plateCanopy = this.add.tileSprite(0, 0, w, h, 'plate6_canopy')
        .setOrigin(0, 0)
        .setDepth(0.0)
      this.plateCanopy.tileScaleY = h / canopySrc6.height
      this.plateCanopy.tileScaleX = h / canopySrc6.height

      // MID TREES overlay — trunks span ~80% of frame height. Place anchored
      // so trunk bases sit near the painted ground line.
      const midSrc6 = this.textures.get('plate6_mid').getSourceImage() as HTMLImageElement
      this.plateMid = this.add.tileSprite(0, 0, w, h, 'plate6_mid')
        .setOrigin(0, 0)
        .setDepth(0.5)
      this.plateMid.tileScaleY = h / midSrc6.height
      this.plateMid.tileScaleX = h / midSrc6.height

      // GROUND overlay — measured from actual alpha map of bg_ground.png:
      // painted moss becomes substantial at row 64.5% of source. Anchor
      // that line to the player walk line so player + log sit ON moss,
      // not floating in the transparent zone above it.
      const GROUND_PAINT_START = 0.645  // measured from PNG alpha
      const GROUND_PAINT_FRAC = 1 - GROUND_PAINT_START  // 0.355
      const visualGroundY = this.gs.groundY + Math.round(PLAYER_HEIGHT * 0.4)
      const paintedScreenH = h - visualGroundY
      const plateH = Math.round(paintedScreenH / GROUND_PAINT_FRAC)
      const plateTop = visualGroundY - Math.round(plateH * GROUND_PAINT_START)
      const groundSrc6 = this.textures.get('plate6_ground').getSourceImage() as HTMLImageElement
      this.plateGround = this.add.tileSprite(0, plateTop, w, plateH, 'plate6_ground')
        .setOrigin(0, 0)
        .setDepth(1.0)
      this.plateGround.tileScaleY = plateH / groundSrc6.height
      this.plateGround.tileScaleX = plateH / groundSrc6.height

      this.v5GroundLineY = visualGroundY
      console.log('[v6 placement]', {
        screen: { w, h },
        sky: { tileScaleY: this.plateSky.tileScaleY.toFixed(3) },
        canopy: { tileScaleY: this.plateCanopy.tileScaleY.toFixed(3) },
        mid: { tileScaleY: this.plateMid.tileScaleY.toFixed(3) },
        ground: { y: plateTop, h: plateH, walkLineY: visualGroundY, tileScaleY: this.plateGround.tileScaleY.toFixed(3) },
      })
    } else if (this.hasV5Plates) {
      // CANOPY — fills entire screen, scrolls slowest (15%). Image has
      // canopy art in top 65%, atmospheric haze in bottom 35%. We display
      // it full-screen so the haze covers the area where mid/ground sit.
      this.plateCanopy = this.add.tileSprite(0, 0, w, h, 'plate_canopy')
        .setOrigin(0, 0)
        .setDepth(0.0)
      // Match plate native aspect (2:1 source) to vertical screen by stretching
      // tileScaleY; horizontal tiling stays seamless because POT.
      const canopySrc = this.textures.get('plate_canopy').getSourceImage() as HTMLImageElement
      this.plateCanopy.tileScaleY = h / canopySrc.height
      this.plateCanopy.tileScaleX = h / canopySrc.height  // uniform scale, keep aspect

      // MID TREES — fills bottom 75% of screen so trees grow up from the
      // visual ground area into the canopy. JPG haze top blends with canopy.
      const midY = Math.round(h * 0.20)
      const midH = h - midY
      this.plateMid = this.add.tileSprite(0, midY, w, midH, 'plate_mid')
        .setOrigin(0, 0)
        .setDepth(0.5)
      const midSrc = this.textures.get('plate_mid').getSourceImage() as HTMLImageElement
      this.plateMid.tileScaleY = midH / midSrc.height
      this.plateMid.tileScaleX = midH / midSrc.height

      // GROUND — PNG with transparent top 48% and painted moss/roots/mushrooms
      // in bottom 52%. We size the plate so its 48% line lands at visualGroundY.
      const visualGroundY = this.gs.groundY + Math.round(PLAYER_HEIGHT * 0.4)
      const paintedScreenH = h - visualGroundY  // pixels from walk line to bottom of screen
      const plateH = Math.round(paintedScreenH / 0.52)
      const plateTop = visualGroundY - Math.round(plateH * 0.48)
      this.plateGround = this.add.tileSprite(0, plateTop, w, plateH, 'plate_ground')
        .setOrigin(0, 0)
        .setDepth(1.0)
      const groundSrc = this.textures.get('plate_ground').getSourceImage() as HTMLImageElement
      this.plateGround.tileScaleY = plateH / groundSrc.height
      this.plateGround.tileScaleX = plateH / groundSrc.height

      this.v5GroundLineY = visualGroundY
      console.log('[v5 placement]', {
        screen: { w, h },
        canopy: { x: 0, y: 0, w, h, tileScaleY: this.plateCanopy.tileScaleY.toFixed(3) },
        mid: { x: 0, y: midY, w, h: midH, tileScaleY: this.plateMid.tileScaleY.toFixed(3) },
        ground: { x: 0, y: plateTop, w, h: plateH, walkLineY: visualGroundY, tileScaleY: this.plateGround.tileScaleY.toFixed(3) },
      })
    }

    this.startBobTween()
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05)
    const { width: w, height: h } = this.scale

    // Sync groundY
    const tGY = Math.round(h * 0.74)
    if (Math.abs(this.gs.groundY - tGY) > 10) this.gs.groundY = tGY

    // Track pre-physics pickup state for collection feedback
    const preCollected = this.gs.pickupsCollected
    const preEssence = this.gs.player.x // capture player x for spawn anchor

    // Physics
    updatePhysics(this.gs, dt, w, h)

    // Pickup collection feedback (mote/holocron/bibo)
    if (this.gs.pickupsCollected > preCollected) {
      const delta = this.gs.pickupsCollected - preCollected
      // Find the most-recently-collected pickup near the player to anchor the burst
      const player = this.gs.player
      let burstX = player.x, burstY = player.screenY + 20
      for (const pk of this.gs.pickups) {
        if (pk.collected && Math.abs(pk.x - preEssence) < 80) {
          burstX = pk.x + 7; burstY = pk.y + 7
          break
        }
      }
      this.spawnPickupBurst(burstX, burstY, delta)
    }

    // Run cycle timer
    if (this.gs.player.anim === 'running') {
      this.runTimer += dt
      if (this.runTimer > 0.18) this.runTimer = 0
    }

    // Biome zone (swap every 500 paces)
    const zone = Math.floor(this.gs.distance / 500)
    if (zone !== this.lastBiomeZone) {
      this.lastBiomeZone = zone
      this.biomeTarget = zone % 2 === 1 ? 1 : 0
    }
    this.biomeTint += (this.biomeTarget - this.biomeTint) * Math.min(dt * 0.7, 1)

    // Player anim transitions
    this.syncPlayerAnim()

    // Render layers
    // v5 painterly plates short-circuit ALL the procedural sky/tree/ground/
    // foliage layers. Three TileSprites scroll at their own parallax rates
    // and the ground line is baked into the bottom plate.
    if (this.hasV6Plates) {
      this.renderV6Plates(w, h)
    } else if (this.hasV5Plates) {
      this.renderV5Plates(w, h)
    } else {
      this.renderBackground(w, h)
      this.renderLightBloom(w, h)
      this.renderGodRays(w, h)
      this.renderCanopyArch(w, h)
      if (this.textures.exists('ground_v2')) {
        this.renderPaintedGround(w, this.gs.groundY, h)
      } else {
        this.renderGround(w, h)
      }
    }
    this.renderEntities(w, h)
    this.renderPlayer()
    if (!this.hasV5Plates && !this.hasV6Plates) this.renderForegroundFoliage(w, h)
    this.renderHUD(w, h)
    this.updateHUDText(w, h)

    // Game end
    if (this.gs.phase === 'ended' && !this.gameEndFired) {
      this.gameEndFired = true
      tgHaptic('error')
      this.time.delayedCall(800, () => {
        const score = this.gs.score
        // Swamp Runner is an endless runner -- every death is a 'loss' from
        // a revive-offer perspective, regardless of score. The 'win' outcome
        // would only fire on an explicit clear/checkpoint event (none exist
        // in this game yet).
        this.game.events.emit('gameEnd', { score, outcome: 'loss' })
      })
    }
  }

  // ── Bob tween ─────────────────────────────────────────────────────────────

  private startBobTween(): void {
    this.stopBobTween()
    const t = { v: 0 }
    this.bobTween = this.tweens.add({
      targets: t, v: 3.5,
      duration: 260, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => { this.bobOffset = t.v },
    })
  }

  private stopBobTween(): void {
    this.bobTween?.stop()
    this.bobTween = null
    this.bobOffset = 0
  }

  private syncPlayerAnim(): void {
    const anim = this.gs.player.anim
    if (anim === this.prevAnim) return
    this.prevAnim = anim

    // Swap sprite texture
    if (this.playerImg) {
      const tex = anim === 'jumping' && this.textures.exists('yoda_jump') ? 'yoda_jump'
        : anim === 'hit'  && this.textures.exists('yoda_hit')    ? 'yoda_hit'
        : anim === 'dead' && this.textures.exists('yoda_defeat') ? 'yoda_defeat'
        : this.textures.exists('yoda_idle') ? 'yoda_idle' : null
      if (tex) this.playerImg.setTexture(tex)
    }

    if (anim === 'running') {
      this.startBobTween()
    } else if (anim === 'jumping') {
      this.stopBobTween()
    } else if (anim === 'dead') {
      this.stopBobTween()
      if (this.playerImg) {
        this.tweens.add({
          targets: this.playerImg,
          angle: 90, alpha: 0.55,
          duration: 700, ease: 'Power2.easeIn',
        })
      }
    }
  }

  // ── Background ────────────────────────────────────────────────────────────

  /**
   * Spawn visual feedback when a pickup is collected:
   * golden particle burst + floating "+1" text that fades upward.
   */
  private spawnPickupBurst(x: number, y: number, count: number): void {
    // Particle burst
    if (this.textures.exists('glow_pt')) {
      const burst = this.add.particles(x, y, 'glow_pt', {
        speed: { min: 80, max: 220 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.4, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffe040, 0xffaa20, 0xfff080, 0xffffff],
        lifespan: 480,
        quantity: 14,
        emitting: false,
      }).setDepth(4)
      burst.explode(14)
      this.time.delayedCall(700, () => burst.destroy())
    }
    // Floating +N text
    const text = `+${count}`
    const popup = this.add.text(x, y, text, {
      fontFamily: 'Cinzel, serif',
      fontSize: '24px',
      color: '#ffe040',
      stroke: '#3a2010',
      strokeThickness: 4,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5)
    this.tweens.add({
      targets: popup,
      y: y - 40,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.Out',
      onComplete: () => popup.destroy(),
    })
  }

  private renderBackground(w: number, _h: number): void {
    const g = this.bgGfx; g.clear()
    const gY = this.gs.groundY
    const t = this.biomeTint

    // Smooth sky gradient via many thin bands (no hard seams)
    const STEPS = 24
    for (let i = 0; i < STEPS; i++) {
      const f = i / (STEPS - 1)
      // Interpolate: top -> mid -> low across the band
      let r: number, gC: number, b: number
      if (f < 0.5) {
        const k = f / 0.5
        const top = lerp(DAY.skyTop, TWIL.skyTop, t)
        const mid = lerp(DAY.skyMid, TWIL.skyMid, t)
        r = lerp((top >> 16) & 0xff, (mid >> 16) & 0xff, k)
        gC = lerp((top >> 8) & 0xff, (mid >> 8) & 0xff, k)
        b = lerp(top & 0xff, mid & 0xff, k)
      } else {
        const k = (f - 0.5) / 0.5
        const mid = lerp(DAY.skyMid, TWIL.skyMid, t)
        const low = lerp(DAY.skyLow, TWIL.skyLow, t)
        r = lerp((mid >> 16) & 0xff, (low >> 16) & 0xff, k)
        gC = lerp((mid >> 8) & 0xff, (low >> 8) & 0xff, k)
        b = lerp(mid & 0xff, low & 0xff, k)
      }
      const color = (Math.round(r) << 16) | (Math.round(gC) << 8) | Math.round(b)
      const y0 = Math.floor((i / STEPS) * gY * 1.02)
      const y1 = Math.ceil(((i + 1) / STEPS) * gY * 1.02)
      g.fillStyle(color, 1)
      g.fillRect(0, y0, w, y1 - y0 + 1)
    }

    // Soft mist cloud puffs scattered through the upper sky to fill empty space
    const mistOff = (this.gs.worldOffset * 0.08) % (w * 2)
    for (let i = 0; i < 8; i++) {
      const seed = i * 53.7
      const baseX = (seed * 127) % (w * 2)
      let cx = baseX - mistOff
      if (cx < -120) cx += w * 2
      if (cx > w + 120) cx -= w * 2
      const cy = gY * (0.05 + (seed * 0.31) % 0.35)
      const cw = 80 + (seed * 17) % 60
      const ch = 20 + (seed * 11) % 14
      g.fillStyle(0xfff4d8, 0.18)
      g.fillEllipse(cx, cy, cw, ch)
      g.fillStyle(0xfff4d8, 0.10)
      g.fillEllipse(cx + cw * 0.25, cy + 4, cw * 0.7, ch * 0.85)
    }

    // Mist bands (horizontal atmospheric haze)
    g.fillStyle(0xb4dcb4, 0.075); g.fillRect(0, gY * 0.52, w, 50)
    g.fillStyle(0xb4dcb4, 0.055); g.fillRect(0, gY * 0.64, w, 50)
    g.fillStyle(0xb4dcb4, 0.035); g.fillRect(0, gY * 0.76, w, 50)

    // Use painted tree sprites if loaded (Stage 2); fallback to triangle silhouettes
    if (this.textures.exists('tree_far_v2')) {
      this.renderPaintedTrees(w, gY)
    } else {
      const bgOff = (this.gs.worldOffset * 0.20) % w
      this.drawTreeLayer(g, this.bgTrees, w, gY, bgOff,     lerp(DAY.bgTree, TWIL.bgTree, t), 0.38, 0.15)
      this.drawTreeLayer(g, this.bgTrees, w, gY, bgOff - w, lerp(DAY.bgTree, TWIL.bgTree, t), 0.38, 0.15)
      const fgOff = (this.gs.worldOffset * 0.55) % w
      this.drawTreeLayer(g, this.fgTrees, w, gY, fgOff,     lerp(DAY.fgTree, TWIL.fgTree, t), 0.15, 0.12)
      this.drawTreeLayer(g, this.fgTrees, w, gY, fgOff - w, lerp(DAY.fgTree, TWIL.fgTree, t), 0.15, 0.12)
    }
  }

  /**
   * Render painted tree layers using v2 sprites positioned by world offset.
   * Three depth layers. Trees are much smaller now (~40% of previous), with
   * randomized flip and y-jitter per slot so they don't read as repeating tile.
   */
  private renderPaintedTrees(w: number, gY: number): void {
    // Pool sizes and spacings chosen so trees always fill the viewport:
    // spacing < screenWidth guarantees continuous coverage without gaps
    const FAR_POOL  = 9,  FAR_SPACING  = Math.round(w * 0.40)   // ~2.5 far trees always visible
    const MID_POOL  = 6,  MID_SPACING  = Math.round(w * 0.60)   // ~1.7 mid trees visible
    const NEAR_POOL = 5,  NEAR_SPACING = Math.round(w * 0.85)   // ~1.2 near trees visible

    const ensurePool = (
      arr: Phaser.GameObjects.Image[], texKey: string,
      depth: number, baseScaleY: number, poolSize: number,
    ) => {
      if (arr.length === 0) {
        for (let i = 0; i < poolSize; i++) {
          const img = this.add.image(0, 0, texKey).setOrigin(0.5, 1).setDepth(depth)
          // Per-slot variation: alternating flip, scale ±15%, y-jitter
          const flip = (i * 37) % 7 < 3 ? -1 : 1
          const scaleVariation = 0.88 + ((i * 43) % 25) / 100  // 0.88–1.13
          const yJitter = ((i * 17) % 13) - 6  // -6 to +6 px
          img.setData('flip', flip)
          img.setData('scaleY', baseScaleY * scaleVariation)
          img.setData('yJitter', yJitter)
          arr.push(img)
        }
      }
    }

    // Tree scale = fraction of screen height for each parallax layer. These
    // are bottom-anchored sprites planted at the ground line, so the value
    // represents how tall the tree appears above ground. Tuned smaller now
    // that trees actually plant on the ground (previously they floated, so
    // big values were partially clipped above the visible area).
    ensurePool(this.treeFarSprites,  'tree_far_v2',  0.5, 0.14, FAR_POOL)   // distant horizon trees
    ensurePool(this.treeMidSprites,  'tree_mid_v2',  0.7, 0.20, MID_POOL)   // mid-ground silhouettes
    ensurePool(this.treeNearSprites, 'tree_near_v2', 0.9, 0.28, NEAR_POOL)  // near backdrop trees (still behind player)

    const screenH = this.scale.height

    // [sprites, parallaxRate, anchorY, tint, alpha, spacing, poolSize]
    type LayerSpec = [Phaser.GameObjects.Image[], number, number, number, number, number, number]
    const visualGroundY = gY + Math.round(PLAYER_HEIGHT * 0.4)
    // Depth haze: far trees get strong fog (low alpha + desaturated tint),
    // mid trees moderate fog, near trees crisp. Creates the Silksong-style
    // atmospheric depth layering without post-processing.
    const layers: LayerSpec[] = [
      [this.treeFarSprites,  0.15, visualGroundY + 2, 0x7a9a6a, 0.35, FAR_SPACING,  FAR_POOL],
      [this.treeMidSprites,  0.40, visualGroundY + 3, 0xa8c890, 0.60, MID_SPACING,  MID_POOL],
      [this.treeNearSprites, 0.70, visualGroundY + 4, 0xd8ecc0, 0.90, NEAR_SPACING, NEAR_POOL],
    ]

    for (const [pool, parallax, anchorY, tint, alpha, spacing, poolSize] of layers) {
      const off = this.gs.worldOffset * parallax
      const span = poolSize * spacing
      for (let i = 0; i < poolSize; i++) {
        const baseX = i * spacing
        let x = ((baseX - (off % span)) % span + span) % span
        if (x > span - spacing / 2) x -= span
        if (x < -spacing || x > w + spacing) continue

        const img = pool[i]
        const scaleY = img.getData('scaleY') as number
        const flip   = img.getData('flip')   as number
        const yJitter = img.getData('yJitter') as number
        const targetHeight = screenH * scaleY
        img.setPosition(x, anchorY + yJitter)
        img.setDisplaySize(targetHeight * 0.48 * flip, targetHeight)
        img.setTint(tint)
        img.setAlpha(alpha)  // depth haze
      }
    }
  }

  // ── God rays (Silksong-style diagonal light shafts) ────────────────────
  //
  // Semi-transparent diagonal strips that drift slowly across the canopy,
  // creating the "light filtering through trees" effect. Rendered as a
  // separate graphics layer between background and trees (depth 0.3).

  // ── Foreground foliage (Silksong-style parallax bokeh) ──────────────────
  //
  // Dark silhouette sprites at depth 3.5 (in front of the player) scrolling
  // at 1.15× speed. Creates "foreground framing" depth. Uses reed + mushroom
  // sprites tinted dark green with low alpha.

  private renderForegroundFoliage(w: number, h: number): void {
    const FG_POOL = 6
    const FG_SPACING = Math.round(w * 0.55)
    const gY = this.gs.groundY
    const visualGroundY = gY + Math.round(PLAYER_HEIGHT * 0.4)
    // Lazy-init pool
    if (this.fgFoliage.length === 0) {
      const texKeys = ['mushroom_v2', 'reed_v2'].filter((k) => this.textures.exists(k))
      if (texKeys.length === 0) return
      for (let i = 0; i < FG_POOL; i++) {
        const tex = texKeys[i % texKeys.length]
        const img = this.add.image(0, 0, tex)
          .setOrigin(0.5, 1)
          .setDepth(3.5)
          .setTint(0x1a2a10)
          .setAlpha(0.30)
          .setVisible(false)
        // Randomised scale per sprite
        const s = 0.6 + (((i * 37 + 13) % 17) / 17) * 0.8  // 0.6-1.4
        img.setData('fgScale', s)
        img.setData('fgFlip', (i % 3 === 0) ? -1 : 1)
        this.fgFoliage.push(img)
      }
    }
    // Position: scroll at 1.15× world speed (foreground parallax)
    const off = this.gs.worldOffset * 1.15
    const span = FG_POOL * FG_SPACING
    for (let i = 0; i < FG_POOL; i++) {
      const baseX = i * FG_SPACING
      let x = ((baseX - (off % span)) % span + span) % span
      if (x > span - FG_SPACING / 2) x -= span
      if (x < -FG_SPACING || x > w + FG_SPACING) {
        this.fgFoliage[i].setVisible(false)
        continue
      }
      const img = this.fgFoliage[i]
      const s = img.getData('fgScale') as number
      const flip = img.getData('fgFlip') as number
      const baseH = h * 0.12 * s  // short foliage, ~12% of screen
      img.setPosition(x, visualGroundY + 8)
      img.setDisplaySize(baseH * 0.6 * flip, baseH)
      img.setVisible(true)
    }
  }

  private godRayGfx: Phaser.GameObjects.Graphics | null = null

  // ── Light bloom hotspots (Silksong-style atmospheric glow) ────────────────
  //
  // Soft radial gradients in the sky/canopy area suggesting hidden sun-spots
  // through the foliage. Two bloom centres drift very slowly with parallax,
  // giving the sky a sense of warmth and depth. Rendered at depth 0.2 (above
  // sky gradient, below god rays).

  private bloomGfx: Phaser.GameObjects.Graphics | null = null

  private renderLightBloom(w: number, _h: number): void {
    if (!this.bloomGfx) {
      this.bloomGfx = this.add.graphics().setDepth(0.2)
    }
    const g = this.bloomGfx; g.clear()
    const gY = this.gs.groundY
    const off = this.gs.worldOffset
    // Two parallax-drifting bloom centres
    const blooms = [
      { cx: ((off * 0.03) % w + w * 0.25) % w, cy: gY * 0.25, r: gY * 0.55, color: 0xfff4b0, alpha: 0.10 },
      { cx: ((off * 0.025) % w + w * 0.75) % w, cy: gY * 0.40, r: gY * 0.45, color: 0xe8ffaa, alpha: 0.08 },
    ]
    for (const b of blooms) {
      // Layer 5 concentric circles with falloff alpha to fake a soft radial
      // gradient (Phaser Graphics has no native radial gradient).
      const RINGS = 6
      for (let i = RINGS; i >= 1; i--) {
        const ringR = b.r * (i / RINGS)
        const ringAlpha = b.alpha * (1 - i / RINGS) * 1.2
        g.fillStyle(b.color, ringAlpha)
        g.fillCircle(b.cx, b.cy, ringR)
      }
    }
  }

  // ── Canopy arch (Silksong-style top-of-screen organic framing) ────────────
  //
  // Drooping vine/moss clusters along the top edge of the screen so the
  // player feels inside a place, not in front of a wall. Sprites pulled
  // from existing vine_v2 + tree_near_v2 silhouettes, tinted very dark and
  // anchored to the top with origin (0.5, 0). Slow parallax (0.20) so they
  // feel attached to the canopy.

  private canopySprites: Phaser.GameObjects.Image[] = []

  private renderCanopyArch(w: number, _h: number): void {
    const CANOPY_POOL = 8
    const CANOPY_SPACING = Math.round(w * 0.35)
    // Lazy-init pool
    if (this.canopySprites.length === 0) {
      // Prefer vine sprite; fall back to tree_near; bail if neither loaded.
      const tex = this.textures.exists('vine_v2') ? 'vine_v2'
        : this.textures.exists('tree_near_v2') ? 'tree_near_v2'
        : null
      if (!tex) return
      for (let i = 0; i < CANOPY_POOL; i++) {
        const img = this.add.image(0, 0, tex)
          .setOrigin(0.5, 0)  // anchor to top so the cluster droops down
          .setDepth(0.4)       // above god rays, below tree silhouettes
          .setTint(0x1a3520)
          .setAlpha(0.65)
          .setAngle(180)        // flip vertically so vine droops downward
          .setVisible(false)
        const s = 0.7 + (((i * 31 + 7) % 13) / 13) * 0.7  // 0.7-1.4
        img.setData('cScale', s)
        img.setData('cFlip', (i % 2 === 0) ? -1 : 1)
        this.canopySprites.push(img)
      }
    }
    // Position: slow parallax (canopy is "close" to camera in vertical sense
    // but distant horizontally) — drift at 0.20 of world offset.
    const off = this.gs.worldOffset * 0.20
    const span = CANOPY_POOL * CANOPY_SPACING
    for (let i = 0; i < CANOPY_POOL; i++) {
      const baseX = i * CANOPY_SPACING
      let x = ((baseX - (off % span)) % span + span) % span
      if (x > span - CANOPY_SPACING / 2) x -= span
      if (x < -CANOPY_SPACING || x > w + CANOPY_SPACING) {
        this.canopySprites[i].setVisible(false)
        continue
      }
      const img = this.canopySprites[i]
      const s = img.getData('cScale') as number
      const flip = img.getData('cFlip') as number
      const baseH = this.gs.groundY * 0.40 * s  // each cluster ~25% of sky
      img.setPosition(x, -8)                   // slightly above top edge
      img.setDisplaySize(baseH * 0.45 * flip, baseH)
      img.setVisible(true)
    }
  }

  private renderGodRays(w: number, _h: number): void {
    if (!this.godRayGfx) {
      this.godRayGfx = this.add.graphics().setDepth(0.3)
    }
    const g = this.godRayGfx; g.clear()
    const gY = this.gs.groundY
    const t = this.gs.gameTime
    // 3 rays at different speeds/positions
    const rays = [
      { speed: 0.012, width: 120, alpha: 0.06, offset: 0 },
      { speed: 0.008, width: 80,  alpha: 0.04, offset: w * 0.35 },
      { speed: 0.015, width: 60,  alpha: 0.05, offset: w * 0.7 },
    ]
    for (const ray of rays) {
      // Ray drifts slowly across the screen, wrapping
      const cx = ((ray.offset + t * ray.speed * w) % (w + ray.width * 4)) - ray.width * 2
      // Diagonal parallelogram from top to groundY
      const skew = ray.width * 0.6  // how much the ray leans
      g.fillStyle(0xeeffaa, ray.alpha)
      g.fillTriangle(cx, 0, cx + ray.width, 0, cx + ray.width + skew, gY)
      g.fillTriangle(cx, 0, cx + skew, gY, cx + ray.width + skew, gY)
    }
  }

  /**
   * Render a painted ground tile band that scrolls with the world.
   * Replaces the flat solid-color ground strip with painted swamp ground.
   */
  // ── v5 painterly plate scrollers ─────────────────────────────────────────
  //
  // Three TileSprite layers scrolling at distinct parallax rates. The bottom
  // (ground) plate has the walk-line baked in; player feet snap to v5GroundLineY.

  private renderV5Plates(_w: number, _h: number): void {
    const off = this.gs.worldOffset
    if (this.plateCanopy) this.plateCanopy.tilePositionX = off * 0.15
    if (this.plateMid)    this.plateMid.tilePositionX    = off * 0.45
    if (this.plateGround) this.plateGround.tilePositionX = off * 1.00
  }

  // ── v6 painterly plate scrollers ─────────────────────────────────────────
  //
  // Four layers: opaque sky backdrop (slowest, depth=-1) + three cutout
  // overlays (canopy/mid/ground) at increasing parallax rates. True depth
  // illusion: each overlay reveals the sky behind it through its alpha.

  private renderV6Plates(_w: number, _h: number): void {
    const off = this.gs.worldOffset
    if (this.plateSky)    this.plateSky.tilePositionX    = off * 0.05
    if (this.plateCanopy) this.plateCanopy.tilePositionX = off * 0.15
    if (this.plateMid)    this.plateMid.tilePositionX    = off * 0.40
    if (this.plateGround) this.plateGround.tilePositionX = off * 1.00
  }

  private renderPaintedGround(w: number, gY: number, screenH: number): void {
    // Visual ground line: the painted ground tile's TOP edge must align with
    // the player's visual feet, not with state.groundY (the collision line).
    // The player sprite is drawn at 1.4× PLAYER_HEIGHT but positioned with
    // top = groundY - PLAYER_HEIGHT, so visually the player's feet end at
    // ~groundY + (PLAYER_HEIGHT * 0.4). We snap the painted ground top to
    // that line so the player walks on the visible ground instead of above
    // a band that floats below.
    const visualGroundY = gY + Math.round(PLAYER_HEIGHT * 0.4)
    const bandHeight = screenH - visualGroundY + 8
    if (!this.groundTile) {
      this.groundTile = this.add.tileSprite(0, visualGroundY, w, bandHeight, 'ground_v2')
        .setOrigin(0, 0)
        .setDepth(1.0)
      this.groundTile.tileScaleX = 0.6
      this.groundTile.tileScaleY = 0.5
    }
    // Scroll the tile horizontally with the world (ground moves at 100% rate)
    this.groundTile.tilePositionX = this.gs.worldOffset
    this.groundTile.setSize(w, bandHeight)
    this.groundTile.setPosition(0, visualGroundY)
  }

  private drawTreeLayer(
    g: Phaser.GameObjects.Graphics,
    trees: { nx: number; nh: number; nw: number }[],
    w: number, gY: number, offset: number,
    color: number, topFrac: number, widthFrac: number,
  ): void {
    g.fillStyle(color, 1)
    for (const tree of trees) {
      const tx = tree.nx * w - offset
      const tw = tree.nw * w * (widthFrac / 0.04)
      const th = tree.nh * gY * (topFrac / 0.38)
      // Layered mangrove silhouette (3 stacked triangles)
      g.fillTriangle(tx, gY, tx - tw * 0.50, gY - th * 0.45, tx + tw * 0.50, gY - th * 0.45)
      g.fillTriangle(tx, gY - th * 0.35, tx - tw * 0.42, gY - th * 0.70, tx + tw * 0.42, gY - th * 0.70)
      g.fillTriangle(tx, gY - th * 0.62, tx - tw * 0.28, gY - th, tx + tw * 0.28, gY - th)
    }
  }

  // ── Ground ────────────────────────────────────────────────────────────────

  private renderGround(w: number, h: number): void {
    const g = this.groundGfx; g.clear()
    const gY = this.gs.groundY
    const t = this.biomeTint

    // Water
    g.fillStyle(lerp(DAY.waterTop, TWIL.waterTop, t), 1); g.fillRect(0, gY, w, (h - gY) * 0.35)
    g.fillStyle(lerp(DAY.waterBot, TWIL.waterBot, t), 1); g.fillRect(0, gY + (h - gY) * 0.35, w, (h - gY) * 0.65)

    // Water ripples
    g.lineStyle(1.5, 0x3ca064, Phaser.Math.Linear(0.18, 0.06, t))
    for (let i = 0; i < 4; i++) {
      const wy = gY + 10 + i * 14
      const wOff = (this.gs.worldOffset * 0.3 + i * 40) % w
      g.beginPath(); g.moveTo(-wOff % w, wy)
      for (let x = 0; x < w + 60; x += 20) g.lineTo(x - (wOff % 60), wy + Math.sin(x * 0.05 + i) * 2)
      g.strokePath()
    }

    // Ground strip
    g.fillStyle(lerp(DAY.groundTop, TWIL.groundTop, t), 1); g.fillRect(0, gY - 8, w, 14)
    g.fillStyle(lerp(DAY.groundBot, TWIL.groundBot, t), 1); g.fillRect(0, gY + 6, w, 10)

    // Grass tufts
    const spacing = w / 10, tuftOff = this.gs.worldOffset % spacing
    g.fillStyle(lerp(DAY.grass, TWIL.grass, t), 1)
    for (let i = 0; i < 12; i++) {
      const tx = i * spacing - tuftOff
      for (let gi = -2; gi <= 2; gi++) {
        const gx = tx + gi * 3
        g.fillTriangle(gx - 2, gY - 8, gx + 2, gY - 8, gx, gY - 18 - Math.abs(gi) * 2)
      }
    }
  }

  // ── Entities ──────────────────────────────────────────────────────────────

  private renderEntities(w: number, h: number): void {
    const g = this.entityGfx; g.clear()
    // If painted v2 obstacle sprites are loaded, use them. Otherwise fall back to Graphics.
    const usePainted = this.textures.exists('log_v2')
    if (usePainted) {
      this.renderPaintedEntities()
    } else {
      for (const pl of this.gs.platforms) this.drawPlatform(g, pl)
      for (const pk of this.gs.pickups) { if (!pk.collected) this.drawPickup(g, pk) }
      for (const ob of this.gs.obstacles) this.drawObstacle(g, ob)
    }

    // Screen flash overlay
    const fa = Math.max(0, this.gs.screenFlashTimer / 0.4) * 0.35
    if (fa > 0) { g.fillStyle(0x64b4ff, fa); g.fillRect(0, 0, w, h) }
  }

  /**
   * Render obstacles/pickups/platforms using v2 painted sprites.
   * Maintains sprite pools per type; hides unused sprites each frame.
   */
  private renderPaintedEntities(): void {
    // pool helpers
    const getPool = (key: string): Phaser.GameObjects.Image[] => {
      let pool = this.obstaclePool.get(key)
      if (!pool) { pool = []; this.obstaclePool.set(key, pool) }
      return pool
    }
    const useSprite = (poolKey: string, texKey: string, depth: number): Phaser.GameObjects.Image => {
      const pool = getPool(poolKey)
      // Find first hidden sprite or create new
      for (const s of pool) {
        if (!s.visible) { s.setVisible(true); s.setTexture(texKey); return s }
      }
      const img = this.add.image(0, 0, texKey).setOrigin(0.5, 0.5).setDepth(depth)
      pool.push(img)
      return img
    }
    // Hide all sprites at start; we'll re-show what we need
    for (const pool of this.obstaclePool.values()) {
      for (const s of pool) s.setVisible(false)
    }

    // Platforms (logs)
    for (const pl of this.gs.platforms) {
      const y = pl.y + pl.sinkOffset
      const tex = pl.sinking ? 'log_sink_v2' : 'log_v2'
      const img = useSprite('log', tex, 1.5)
      img.setPosition(pl.x + pl.width / 2, y + pl.height / 2)
      img.setDisplaySize(pl.width + 18, pl.height + 22)
    }

    // Pickups
    for (const pk of this.gs.pickups) {
      if (pk.collected) continue
      const tex = pk.type === 'essence' ? 'mote_v2'
                : pk.type === 'holocron' ? 'holocron_v2'
                : pk.type === 'bibo' ? 'bibo_v2' : null
      if (!tex) continue
      const img = useSprite(`pk_${pk.type}`, tex, 2.0)
      // Center the pickup based on its draw radius (essence ~14, holocron ~22, bibo ~32)
      const size = pk.type === 'essence' ? 28 : pk.type === 'holocron' ? 40 : 60
      img.setPosition(pk.x + 7, pk.y + 7)
      img.setDisplaySize(size, size)
      // Gentle pulse for motes via scale modulation
      if (pk.type === 'essence') {
        const pulse = 0.95 + 0.15 * Math.sin(pk.glowPhase)
        img.setScale(img.scale * pulse)
      } else if (pk.type === 'holocron') {
        img.setRotation(pk.glowPhase * 0.4)
      }
    }

    // Obstacles
    for (const ob of this.gs.obstacles) {
      if (ob.type === 'slime') {
        const img = useSprite('slime', 'slime_v2', 2.1)
        img.setPosition(ob.x + ob.width / 2, ob.y + ob.height / 2 + 4)
        img.setDisplaySize(ob.width + 22, ob.height + 18)
      } else if (ob.type === 'mynock') {
        const img = useSprite('mynock', 'mynock_v2', 2.2)
        img.setPosition(ob.x + ob.width / 2, ob.y + ob.height / 2)
        img.setDisplaySize(ob.width + 10, ob.height + 10)
        // Wing flap via vertical scale wobble
        const flap = 1 + 0.12 * Math.sin(this.gs.gameTime * 9 + ob.x * 0.01)
        img.setScale(img.scaleX, img.scaleY * flap)
      } else if (ob.type === 'vine' && (ob.dropped || ob.y > -ob.height)) {
        const img = useSprite('vine', 'vine_v2', 2.0)
        img.setOrigin(0.5, 0)
        img.setPosition(ob.x + ob.width / 2, ob.y)
        img.setDisplaySize(ob.width + 20, ob.height)
      } else if (ob.type === 'vine_shadow' && ob.dropCountdown > 0) {
        // Keep the shadow rendered as a Graphics blob (cheap, sells the warning)
        const g = this.entityGfx
        const pulse = 0.3 + 0.45 * Math.abs(Math.sin(this.time.now * 0.006))
        const sc = Math.min(1, ob.dropCountdown)
        g.fillStyle(0x000000, pulse * sc * 0.5)
        g.fillEllipse(ob.x + ob.width / 2, ob.y + 4, ob.width * 0.9 * sc, 10 * sc)
      }
    }
  }

  private drawPlatform(g: Phaser.GameObjects.Graphics, pl: Platform): void {
    const { x, width: pw, height: ph, sinking, sinkOffset } = pl
    const y = pl.y + sinkOffset
    const log = sinking ? 0x5a3010 : 0x8a5830
    const bark = sinking ? 0x3a1808 : 0x5c3812

    g.fillStyle(log, 1); g.fillRoundedRect(x, y, pw, ph, 4)
    g.lineStyle(2, bark, 1); g.strokeRoundedRect(x, y, pw, ph, 4)
    g.lineStyle(1.5, bark, 0.8)
    for (let i = 0; i < 4; i++) {
      const lx = x + (i + 1) * (pw / 5)
      g.beginPath(); g.moveTo(lx, y + 2); g.lineTo(lx, y + ph - 2); g.strokePath()
    }
    g.fillStyle(bark, 1)
    g.fillEllipse(x + 6, y + ph / 2, 8, ph - 4)
    g.fillEllipse(x + pw - 6, y + ph / 2, 8, ph - 4)
    if (sinking) { g.lineStyle(2.5, 0xff6400, 0.75); g.strokeRoundedRect(x - 1, y - 1, pw + 2, ph + 2, 4) }
  }

  private drawObstacle(g: Phaser.GameObjects.Graphics, ob: Obstacle): void {
    const { type, x, y, width: w, height: h } = ob
    const gt = this.gs.gameTime
    if (type === 'slime')       { this.drawSlime(g, x, y, w, h, gt); return }
    if (type === 'mynock')      { this.drawMynock(g, x, y, w, h, gt); return }
    if (type === 'vine' && (ob.dropped || y > -h)) { this.drawVine(g, x, y, w, h); return }
    if (type === 'vine_shadow') { this.drawVineShadow(g, x, y, w, ob.dropCountdown) }
  }

  private drawSlime(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, gt: number): void {
    const pulse = 1 + 0.1 * Math.sin(gt * 4)
    const cx = x + w / 2, cy = y + h / 2 + 4
    g.lineStyle(5, 0x22cc22, 0.35); g.strokeEllipse(cx, cy, (w + 10) * pulse, (h + 14) * pulse)
    g.fillStyle(0x66dd22, 1);       g.fillEllipse(cx, cy, w * pulse, (h + 8) * pulse)
    g.fillStyle(0xbbff55, 0.75);    g.fillEllipse(cx - w * 0.12, cy - h * 0.2, w * 0.4, h * 0.35)
    g.lineStyle(3, 0x117700, 1);    g.strokeEllipse(cx, cy, w * pulse, (h + 8) * pulse)
    // Eyes
    g.fillStyle(0xffffff, 1); g.fillCircle(cx - 5, cy - 3, 4);   g.fillCircle(cx + 5, cy - 3, 4)
    g.fillStyle(0x111111, 1); g.fillCircle(cx - 4, cy - 3, 2.5); g.fillCircle(cx + 6, cy - 3, 2.5)
  }

  private drawMynock(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, gt: number): void {
    const cx = x + w / 2, cy = y + h / 2
    const flap = Math.sin(gt * 9 + x * 0.01) * 0.35
    const wY = cy - h * 0.3 - h * 0.22 * flap
    // Wings (behind body)
    g.fillStyle(0x5a1a3a, 0.9);       g.fillTriangle(cx, cy, cx - w * 0.52, wY, cx - w * 0.32, cy + h * 0.12)
    g.lineStyle(1.5, 0x220d2a, 0.85); g.strokeTriangle(cx, cy, cx - w * 0.52, wY, cx - w * 0.32, cy + h * 0.12)
    g.fillStyle(0x5a1a3a, 0.9);       g.fillTriangle(cx, cy, cx + w * 0.52, wY, cx + w * 0.32, cy + h * 0.12)
    g.lineStyle(1.5, 0x220d2a, 0.85); g.strokeTriangle(cx, cy, cx + w * 0.52, wY, cx + w * 0.32, cy + h * 0.12)
    // Body (over wings)
    g.fillStyle(0x3a1a5a, 1);   g.fillEllipse(cx, cy, w * 0.38, h * 0.65)
    g.lineStyle(2, 0x220d3a, 1); g.strokeEllipse(cx, cy, w * 0.38, h * 0.65)
    // Red eyes
    g.fillStyle(0xff2222, 1); g.fillCircle(cx - 5, cy - 3, 4.5); g.fillCircle(cx + 5, cy - 3, 4.5)
    g.fillStyle(0xff9999, 1); g.fillCircle(cx - 4, cy - 4, 1.8); g.fillCircle(cx + 6, cy - 4, 1.8)
  }

  private drawVine(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const vx = x + w * 0.3, vw = w * 0.4
    g.fillStyle(0x2d5a18, 1); g.fillRoundedRect(vx, y, vw, h, { tl: 0, tr: 0, bl: 4, br: 4 })
    g.lineStyle(2.5, 0x0d2008, 1); g.strokeRoundedRect(vx, y, vw, h, { tl: 0, tr: 0, bl: 4, br: 4 })
    for (let i = 0; i < 4; i++) {
      const ly = y + (i + 1) * (h / 5), side = i % 2 === 0 ? -1 : 1
      g.fillStyle(0x4a8a1a, 1); g.fillEllipse(x + w / 2 + side * 10, ly, 14, 8)
      g.lineStyle(1, 0x2a5a08, 1); g.strokeEllipse(x + w / 2 + side * 10, ly, 14, 8)
    }
  }

  private drawVineShadow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, countdown: number): void {
    if (countdown <= 0) return
    const pulse = 0.3 + 0.45 * Math.abs(Math.sin(this.time.now * 0.006))
    const sc = Math.min(1, countdown)
    g.fillStyle(0x000000, pulse * sc * 0.5)
    g.fillEllipse(x + w / 2, y + 4, w * 0.9 * sc, 10 * sc)
  }

  private drawPickup(g: Phaser.GameObjects.Graphics, pk: Pickup): void {
    const { type, x, y, glowPhase: ph } = pk
    if (type === 'essence')  { this.drawEssence(g, x, y, ph);  return }
    if (type === 'holocron') { this.drawHolocron(g, x, y, ph); return }
    if (type === 'bibo')     { this.drawBibo(g, x, y, ph) }
  }

  private drawEssence(g: Phaser.GameObjects.Graphics, x: number, y: number, ph: number): void {
    const glow = 0.5 + 0.5 * Math.sin(ph), r = 9 + 2.5 * Math.sin(ph * 1.3)
    const cx = x + 7, cy = y + 7
    g.lineStyle(4, 0x44ffaa, glow * 0.4); g.strokeCircle(cx, cy, r + 5)
    g.fillStyle(0x88ffcc, 0.92); g.fillCircle(cx, cy, r)
    g.fillStyle(0xeefff0, 0.95); g.fillCircle(cx - 2, cy - 2, r * 0.4)
    g.lineStyle(2, 0x00bb66, 1); g.strokeCircle(cx, cy, r)
    g.lineStyle(1.5, 0xccffe8, glow * 0.65)
    g.beginPath(); g.moveTo(cx, cy - r - 4); g.lineTo(cx, cy + r + 4)
    g.moveTo(cx - r - 4, cy); g.lineTo(cx + r + 4, cy); g.strokePath()
  }

  private drawHolocron(g: Phaser.GameObjects.Graphics, x: number, y: number, ph: number): void {
    const cx = x + 11, cy = y + 11, rot = ph * 0.5
    const s = Math.sin(rot), c = Math.cos(rot), hw = 10, hh = 10
    g.lineStyle(5, 0x4488ff, 0.35); g.strokeRect(cx - hw - 3, cy - hh - 3, (hw + 3) * 2, (hh + 3) * 2)
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([rx, ry]) => ({
      x: cx + rx! * c - ry! * s, y: cy + rx! * s + ry! * c,
    }))
    g.fillStyle(0x4499ff, 0.95); g.fillPoints(corners, true, true)
    g.lineStyle(2, 0xaaddff, 1); g.strokePoints(corners, true, true)
    g.fillStyle(0xddeeff, 1); g.fillCircle(cx, cy, 3.5)
  }

  private drawBibo(g: Phaser.GameObjects.Graphics, x: number, y: number, ph: number): void {
    const cx = x + 20, cy = y + 15, bob = Math.sin(ph * 1.5) * 3
    g.lineStyle(2.5, 0x88ccff, 0.6); g.strokeEllipse(cx + 5, cy + bob, 52, 36)
    g.fillStyle(0x4a6a8a, 1); g.fillEllipse(cx, cy + bob, 36, 20)
    g.lineStyle(1.5, 0x2a4a6a, 1); g.strokeEllipse(cx, cy + bob, 36, 20)
    g.fillStyle(0x5a7a9a, 1); g.fillEllipse(cx + 14, cy - 4 + bob, 16, 14)
    g.fillStyle(0xffffff, 1); g.fillCircle(cx + 17, cy - 5 + bob, 3)
    g.fillStyle(0x222222, 1); g.fillCircle(cx + 17, cy - 5 + bob, 1.5)
    g.fillStyle(0x3a5a7a, 1); g.fillTriangle(cx - 5, cy + bob, cx - 14, cy + 8 + bob, cx - 2, cy + 6 + bob)
  }

  // ── Player ────────────────────────────────────────────────────────────────

  private renderPlayer(): void {
    const g = this.playerGfx; g.clear()
    const p = this.gs.player
    const PW = PLAYER_WIDTH * 1.4, PH = PLAYER_HEIGHT * 1.4
    const px = p.x - PW / 2
    // Apply bob offset for idle run; anchor bottom to state position
    const bobY = p.anim === 'running' ? -this.bobOffset : 0
    // Sprite alpha bbox has empty padding below the planted foot when other foot is lifted;
    // compensate so the planted foot visually touches ground. Also Egor sticker has padding
    // below the figure baseline that bbox includes.
    const groundOffset = p.anim === 'running' || p.anim === 'jumping' ? PH * 0.15 : PH * 0.10
    const py = p.screenY - (PH - PLAYER_HEIGHT) + bobY + groundOffset

    // Shield
    if (p.shieldActive) {
      const sp = 0.6 + 0.4 * Math.sin(this.gs.gameTime * 5)
      g.lineStyle(3, 0x78c8ff, sp * 0.8)
      g.strokeEllipse(p.x, p.screenY + PLAYER_HEIGHT / 2, PW * 0.9, PH * 0.7)
    }

    const alpha = p.hitFlashTimer > 0 ? (Math.sin(p.hitFlashTimer * 25) > 0 ? 1 : 0.2) : 1

    if (this.playerImg) {
      const angle = p.anim === 'jumping' ? (p.vy < 0 ? -12 : 8) : 0
      // Walk-cycle frame swap: alternate idle/idle_b every 0.18s while running
      // Walk cycle: procedural lean + scale oscillation (gpt-image-2/gemini can't produce
      // a true leg-swap mid-stride, so we fake it with body-bob + lean — same technique
      // Crossy Road / Subway Surfers use for tiny mobile sprites).
      let runAngle = angle
      let runScaleX = 1
      let runScaleY = 1
      if (p.anim === 'running' && this.textures.exists('yoda_idle')) {
        if (this.playerImg.texture.key !== 'yoda_idle') this.playerImg.setTexture('yoda_idle')
        // Sine waves at 4Hz: lean ~6deg side to side, slight squash on each footfall
        const phase = this.gs.gameTime * 4 * Math.PI
        runAngle = Math.sin(phase) * 6
        runScaleY = 1 - Math.abs(Math.cos(phase)) * 0.06  // squash on impact
        runScaleX = 1 + Math.abs(Math.cos(phase)) * 0.04
      }
      this.playerImg
        .setVisible(true)
        .setPosition(px, py)
        .setDisplaySize(PW * runScaleX, PH * runScaleY)
        .setAlpha(alpha)
        .setAngle(p.anim === 'running' ? runAngle : angle)
    } else {
      g.setAlpha(alpha)
      this.drawFallbackYoda(g, p.x, py, p.anim, this.gs.gameTime, PW, PH)
      g.setAlpha(1)
    }
  }

  private drawFallbackYoda(
    g: Phaser.GameObjects.Graphics,
    cx: number, y: number, anim: string, gt: number, pw: number, ph: number,
  ): void {
    const bodyC = anim === 'dead' ? 0x888888 : anim === 'hit' ? 0xff6666 : 0x7ec850
    const headC = anim === 'dead' ? 0xaaaaaa : 0xc8f080
    const headR = ph * 0.20, bodyW = pw * 0.55, bodyH = ph * 0.42
    const headY = y + headR + 4, bodyY = y + ph * 0.42

    // Robe body
    g.fillStyle(bodyC, 1); g.fillEllipse(cx, bodyY, bodyW, bodyH)
    g.lineStyle(2, 0x334422, 0.7); g.strokeEllipse(cx, bodyY, bodyW, bodyH)

    // Head
    g.fillStyle(headC, 1); g.fillCircle(cx, headY, headR)
    g.lineStyle(2, 0x334422, 0.7); g.strokeCircle(cx, headY, headR)

    // Large Yoda ears
    g.fillStyle(headC, 1)
    g.fillTriangle(cx - headR, headY + 2, cx - headR * 1.8, headY - headR * 0.8, cx - headR * 0.4, headY - headR * 0.3)
    g.fillTriangle(cx + headR, headY + 2, cx + headR * 1.8, headY - headR * 0.8, cx + headR * 0.4, headY - headR * 0.3)
    g.lineStyle(1.5, 0x334422, 0.5)
    g.strokeTriangle(cx - headR, headY + 2, cx - headR * 1.8, headY - headR * 0.8, cx - headR * 0.4, headY - headR * 0.3)
    g.strokeTriangle(cx + headR, headY + 2, cx + headR * 1.8, headY - headR * 0.8, cx + headR * 0.4, headY - headR * 0.3)

    // Eyes
    if (anim === 'jumping') {
      g.fillStyle(0x224422, 1)
      g.fillCircle(cx - headR * 0.35, headY - headR * 0.1, headR * 0.18)
      g.fillCircle(cx + headR * 0.35, headY - headR * 0.1, headR * 0.18)
    } else {
      g.lineStyle(2, 0x224422, 1)
      const ey = headY - headR * 0.05
      g.beginPath(); g.arc(cx - headR * 0.35, ey, headR * 0.15, 0.1, Math.PI - 0.1); g.strokePath()
      g.beginPath(); g.arc(cx + headR * 0.35, ey, headR * 0.15, 0.1, Math.PI - 0.1); g.strokePath()
    }

    // Legs (run sway)
    if (anim === 'running') {
      const sway = Math.sin(gt * 8) * 3
      g.fillStyle(bodyC, 0.65)
      g.fillEllipse(cx - pw * 0.12 + sway, y + ph * 0.8, pw * 0.22, ph * 0.18)
      g.fillEllipse(cx + pw * 0.12 - sway, y + ph * 0.8, pw * 0.22, ph * 0.18)
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private renderHUD(w: number, h: number): void {
    const g = this.hudGfx; g.clear()
    const { speedBoostActive, speedBoostTimer, banner, gameTime: _gt } = this.gs
    void _gt

    // Score card (top-left, fixed)
    const bx = 12, by = 12, bW = 148, bH = 48
    g.fillStyle(0xf0dca0, 0.88); g.fillRoundedRect(bx, by, bW, bH, 6)
    g.lineStyle(1.5, 0xa07830, 0.75); g.strokeRoundedRect(bx, by, bW, bH, 6)
    g.lineStyle(1, 0xa07830, 0.30);   g.strokeRoundedRect(bx + 3, by + 3, bW - 6, bH - 6, 4)

    // Speed boost bar (below score card)
    if (speedBoostActive) {
      const barW = 100, barH = 6, barX = (w - barW) / 2, barY = by + bH + 8
      g.fillStyle(0x000000, 0.4); g.fillRoundedRect(barX, barY, barW, barH, 3)
      const fill = Math.min(1, speedBoostTimer / 2.0)
      g.fillStyle(0x60b0ff, 0.9); g.fillRoundedRect(barX, barY, barW * fill, barH, 3)
      this.boostText?.setPosition(w / 2, barY + barH + 3).setVisible(true)
    } else {
      this.boostText?.setVisible(false)
    }

    // Banner: FIXED at 40% screen height — always below the score card (which ends at y≈60)
    if (banner?.timer && banner.timer > 0) {
      const prog = banner.timer / banner.maxTime
      const alpha = prog > 0.85 ? (1 - (prog - 0.85) / 0.15)
        : prog < 0.15 ? prog / 0.15
        : 1

      const bbanW = Math.min(w - 40, 360), bbanH = 56
      const bbanX = (w - bbanW) / 2
      const bbanY = h * 0.40 - bbanH / 2  // centered at 40% = never overlaps top HUD

      g.fillStyle(0xf0dca0, 0.96 * alpha); g.fillRoundedRect(bbanX, bbanY, bbanW, bbanH, 8)
      g.lineStyle(2, 0xa07830, 0.9 * alpha); g.strokeRoundedRect(bbanX, bbanY, bbanW, bbanH, 8)
      g.lineStyle(1, 0xa07830, 0.4 * alpha); g.strokeRoundedRect(bbanX + 4, bbanY + 4, bbanW - 8, bbanH - 8, 4)

      this.bannerText
        ?.setText(`"${banner.text}"`)
        .setPosition(w / 2, bbanY + bbanH / 2)
        .setAlpha(alpha)
        .setVisible(true)
    } else {
      this.bannerText?.setVisible(false)
    }
  }

  private updateHUDText(w: number, _h: number): void {
    this.scoreValue?.setText(this.gs.score.toString())
    const m = Math.floor(this.gs.gameTime / 60)
    const s = Math.floor(this.gs.gameTime % 60).toString().padStart(2, '0')
    this.timeText?.setText(`${m}:${s}`).setPosition(w - 14, 16)
  }
}
