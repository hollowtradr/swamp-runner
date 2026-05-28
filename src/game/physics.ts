/**
 * src/game/physics.ts — Game physics update
 *
 * Called each frame from the game loop. Mutates state directly.
 * Handles: scrolling, gravity, platform collisions, obstacle collisions,
 * pickup collisions, difficulty scaling, banner system.
 */

import {
  type GameState,
  GRAVITY,
  JUMP_POWER_MIN,
  JUMP_POWER_MAX,
  MAX_JUMP_HOLD_MS,
  BASE_SCROLL_SPEED,
  MAX_SCROLL_SPEED,
  SPEED_BOOST_FACTOR,
  SPEED_BOOST_DURATION,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  COYOTE_TIME_SECS,
  JUMP_BUFFER_SECS,
  PLAYER_HITBOX_RADIUS_INSET,
  SCORE_MILESTONES,
  YODA_QUOTES,
  PACE_SCALE,
} from './state.js'
import { maybeSpawn } from './spawn.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const SINK_WAIT = 1.5      // seconds on sinking log before it sinks
const SINK_SPEED = 120     // px/s sink rate
const VINE_DROP_SPEED = 400  // px/s vine drop speed
const MYNOCK_WOBBLE = 30   // px amplitude
const BANNER_DURATION = 2.0

// ── Main update ───────────────────────────────────────────────────────────────

export function updatePhysics(state: GameState, dt: number, canvasW: number, _canvasH: number): void {
  if (state.phase !== 'playing') return

  state.gameTime += dt

  // ── Difficulty: adjust scroll speed ────────────────────────────────────────
  const targetSpeed = computeTargetSpeed(state.gameTime)
  state.scrollSpeed += (targetSpeed - state.scrollSpeed) * dt * 2
  const effectiveSpeed = state.speedBoostActive
    ? state.scrollSpeed * SPEED_BOOST_FACTOR
    : state.scrollSpeed
  state.maxSpeedReached = Math.max(state.maxSpeedReached, effectiveSpeed)

  // ── Scroll world ────────────────────────────────────────────────────────────
  const scroll = effectiveSpeed * dt
  state.worldOffset += scroll

  for (const pl of state.platforms) pl.x -= scroll
  for (const ob of state.obstacles) ob.x -= scroll
  for (const pk of state.pickups) pk.x -= scroll

  // ── Distance / score ────────────────────────────────────────────────────────
  state.distance = Math.floor(state.worldOffset / PACE_SCALE)
  state.score = state.distance  // pickups add directly to score

  // ── Speed boost timer ───────────────────────────────────────────────────────
  if (state.speedBoostActive) {
    state.speedBoostTimer -= dt
    if (state.speedBoostTimer <= 0) {
      state.speedBoostActive = false
      state.speedBoostTimer = 0
    }
  }

  // ── Screen flash timer ──────────────────────────────────────────────────────
  if (state.screenFlashTimer > 0) {
    state.screenFlashTimer -= dt
  }

  // ── Shield timer ────────────────────────────────────────────────────────────
  const p = state.player
  if (p.shieldActive) {
    p.shieldTimer -= dt
    if (p.shieldTimer <= 0) {
      p.shieldActive = false
      p.shieldTimer = 0
    }
  }

  // ── Hit flash timer ─────────────────────────────────────────────────────────
  if (p.hitFlashTimer > 0) {
    p.hitFlashTimer -= dt
  }

  // ── Coyote timer — 100ms grace window after walking off edge ─────────────────
  if (p.coyoteTimer > 0) {
    p.coyoteTimer = Math.max(0, p.coyoteTimer - dt)
  }

  // ── Jump buffer timer — 150ms pre-buffer; auto-fires on landing ───────────────
  if (p.jumpBufferTimer > 0) {
    p.jumpBufferTimer = Math.max(0, p.jumpBufferTimer - dt)
  }

  // ── Jump hold: accumulate time ──────────────────────────────────────────────
  if (p.isHoldingJump && p.grounded && p.anim !== 'dead') {
    p.jumpHoldMs += dt * 1000
    if (p.jumpHoldMs > MAX_JUMP_HOLD_MS) p.jumpHoldMs = MAX_JUMP_HOLD_MS
  }

  // ── Gravity ─────────────────────────────────────────────────────────────────
  if (!p.grounded) {
    p.vy += GRAVITY * dt
    p.screenY += p.vy * dt
  }

  // ── Platform collisions ─────────────────────────────────────────────────────
  let onSomePlatform = false
  for (const pl of state.platforms) {
    const screenTopY = pl.y + pl.sinkOffset

    // Player feet are at p.screenY + PLAYER_HEIGHT
    const playerFeet = p.screenY + PLAYER_HEIGHT
    const playerLeft = p.x - PLAYER_WIDTH / 2
    const playerRight = p.x + PLAYER_WIDTH / 2
    const platLeft = pl.x
    const platRight = pl.x + pl.width

    // Check horizontal overlap
    const horizOverlap = playerRight > platLeft + 4 && playerLeft < platRight - 4

    if (horizOverlap && p.vy >= 0) {
      // Player falling onto platform from above?
      const prevFeet = playerFeet - p.vy * dt - 2
      if (prevFeet <= screenTopY && playerFeet >= screenTopY) {
        // Land on platform
        p.screenY = screenTopY - PLAYER_HEIGHT
        p.vy = 0
        p.grounded = true; p.doubleJumpAvailable = false
        p.onPlatformId = pl.id
        p.anim = 'running'
        onSomePlatform = true

        // Sinking log handling
        if (pl.type === 'sinking_log') {
          pl.sinkTimer += dt
          if (pl.sinkTimer >= SINK_WAIT && !pl.sinking) {
            pl.sinking = true
          }
        }

        // Jump buffer — player pressed jump just before landing, fire immediately
        if (p.jumpBufferTimer > 0) {
          p.jumpBufferTimer = 0
          p.vy = -JUMP_POWER_MIN
          p.grounded = false
          p.onPlatformId = null
          p.anim = 'jumping'
          p.doubleJumpAvailable = true
          onSomePlatform = false
        }
      } else if (playerFeet > screenTopY && playerFeet < screenTopY + pl.height + 40
                 && p.onPlatformId === pl.id) {
        // Already on this platform
        p.screenY = screenTopY - PLAYER_HEIGHT
        p.vy = 0
        p.grounded = true; p.doubleJumpAvailable = false
        p.onPlatformId = pl.id
        p.anim = 'running'
        onSomePlatform = true

        if (pl.type === 'sinking_log') {
          pl.sinkTimer += dt
          if (pl.sinkTimer >= SINK_WAIT) pl.sinking = true
        }
      }
    } else if (p.onPlatformId === pl.id && !horizOverlap) {
      // Walked off platform edge — start coyote grace window (100ms)
      if (p.grounded) {
        p.coyoteTimer = COYOTE_TIME_SECS
      }
      p.onPlatformId = null
      p.grounded = false
    }
  }

  // ── Sinking log update ──────────────────────────────────────────────────────
  for (const pl of state.platforms) {
    if (pl.sinking) {
      pl.sinkOffset += SINK_SPEED * dt
      // If player is on this sinking log, drag them down
      if (p.onPlatformId === pl.id) {
        p.screenY += SINK_SPEED * dt
      }
      // If log has sunk far enough, kill player standing on it
      if (pl.sinkOffset > 120 && p.onPlatformId === pl.id) {
        killPlayer(state)
        return
      }
    }
  }

  // ── Ground collision ─────────────────────────────────────────────────────────
  const groundFeetY = state.groundY
  const playerFeet = p.screenY + PLAYER_HEIGHT

  if (!onSomePlatform && playerFeet >= groundFeetY) {
    p.screenY = groundFeetY - PLAYER_HEIGHT
    p.vy = 0
    if (!p.grounded) {
      // Just landed
      p.anim = 'running'
    }
    p.grounded = true; p.doubleJumpAvailable = false
    p.onPlatformId = null

    // Jump buffer — auto-fire if player had a buffered jump input
    if (p.jumpBufferTimer > 0) {
      p.jumpBufferTimer = 0
      p.vy = -JUMP_POWER_MIN
      p.grounded = false
      p.anim = 'jumping'
      p.doubleJumpAvailable = true
    }
  } else if (!onSomePlatform) {
    p.grounded = false
    if (p.anim === 'running' && p.vy < 0) {
      p.anim = 'jumping'
    }
  }

  // ── Obstacle updates ──────────────────────────────────────────────────────────
  for (const ob of state.obstacles) {
    if (ob.type === 'mynock') {
      // Subtle Y wobble
      ob.vy += (Math.sin(state.gameTime * 3 + ob.id) * MYNOCK_WOBBLE - ob.vy) * dt * 2
      ob.y += ob.vy * dt
    }

    if (ob.type === 'vine_shadow') {
      // Count down before vine drops
      ob.dropCountdown -= dt
    }

    if (ob.type === 'vine') {
      ob.dropCountdown -= dt
      if (ob.dropCountdown <= 0 && !ob.dropped) {
        ob.dropped = true
      }
      if (ob.dropped) {
        ob.y += VINE_DROP_SPEED * dt
        // Stop when extended to full drop position
        if (ob.y > state.groundY - ob.height - 20) {
          ob.y = state.groundY - ob.height - 20
        }
      }
    }
  }

  // ── Obstacle collision ────────────────────────────────────────────────────────
  if (p.anim !== 'dead' && p.hitFlashTimer <= 0) {
    // Circular hitbox: center + radius forgives diagonal corner grazes
    const playerCX = p.x
    const playerCY = p.screenY + PLAYER_HEIGHT / 2
    const playerR  = PLAYER_WIDTH / 2 - PLAYER_HITBOX_RADIUS_INSET

    for (const ob of state.obstacles) {
      if (ob.type === 'vine_shadow') continue  // shadow is visual only

      // Vine only hurts when dropped and within reach
      if (ob.type === 'vine' && !ob.dropped) continue

      const obRect = {
        left:   ob.x + 4,
        right:  ob.x + ob.width - 4,
        top:    ob.y + 4,
        bottom: ob.y + ob.height - 4,
      }

      if (circleRectOverlap(playerCX, playerCY, playerR, obRect)) {
        if (p.shieldActive) {
          // Shield absorbs one hit
          p.shieldActive = false
          p.shieldTimer = 0
          p.hitFlashTimer = 1.0
          removeObstacle(state, ob.id)
          break
        } else {
          killPlayer(state)
          return
        }
      }
    }
  }

  // ── Pickup collision ──────────────────────────────────────────────────────────
  for (const pk of state.pickups) {
    if (pk.collected) continue

    const dx = Math.abs((p.x) - (pk.x + 12))
    const dy = Math.abs((p.screenY + PLAYER_HEIGHT / 2) - (pk.y + 12))
    const pickupW = pk.type === 'bibo' ? 40 : (pk.type === 'holocron' ? 22 : 14)
    const pickupH = pk.type === 'bibo' ? 30 : (pk.type === 'holocron' ? 22 : 14)

    if (dx < PLAYER_WIDTH / 2 + pickupW - 2 && dy < PLAYER_HEIGHT / 2 + pickupH) {
      collectPickup(state, pk)
    }

    // Update glow animation
    pk.glowPhase += dt * 3
  }

  // ── Clean up off-screen objects ───────────────────────────────────────────────
  const cullX = -200
  state.platforms = state.platforms.filter((pl) => pl.x + pl.width > cullX)
  state.obstacles = state.obstacles.filter((ob) => ob.x + ob.width > cullX)
  state.pickups   = state.pickups.filter((pk) => !pk.collected && pk.x + 50 > cullX)

  // ── Spawn new objects ─────────────────────────────────────────────────────────
  maybeSpawn(state, canvasW)

  // ── Score milestones ─────────────────────────────────────────────────────────
  for (const milestone of SCORE_MILESTONES) {
    if (state.score >= milestone && !state.milestones.has(milestone)) {
      state.milestones.add(milestone)
      state.banner = {
        text: YODA_QUOTES[milestone],
        timer: BANNER_DURATION,
        maxTime: BANNER_DURATION,
      }
    }
  }

  // ── Banner countdown ─────────────────────────────────────────────────────────
  if (state.banner) {
    state.banner.timer -= dt
    if (state.banner.timer <= 0) state.banner = null
  }

  // ── Canvas bounds: player can't go above top ──────────────────────────────────
  if (p.screenY < 0) {
    p.screenY = 0
    p.vy = Math.max(0, p.vy)
  }

  // ── Prevent player from going below ground (safety) ──────────────────────────
  const playerFeetNow = p.screenY + PLAYER_HEIGHT
  if (playerFeetNow > groundFeetY + 20) {
    killPlayer(state)
  }
}

// ── Jump ──────────────────────────────────────────────────────────────────────

/**
 * Jump mechanics (SOTA endless-runner pattern):
 * - Tap on ground → instant jump at JUMP_POWER_MIN
 * - Hold on ground → accumulate power, release for higher jump (up to JUMP_POWER_MAX)
 * - Tap in air (after first jump) → double-jump at JUMP_POWER_MIN (once per air time)
 * - Coyote time: 100ms grace after walking off edge — fires at JUMP_POWER_MIN (tap-strength)
 * - Jump buffer: 150ms pre-input window; auto-fires on landing
 */
export function startJump(state: GameState): void {
  const p = state.player
  if (p.anim === 'dead' || state.phase !== 'playing') return

  const canCoyoteJump = !p.grounded && p.coyoteTimer > 0

  // Coyote jump: fire immediately at tap-strength (no hold accumulation)
  if (canCoyoteJump) {
    p.coyoteTimer = 0  // consume coyote window
    p.vy = -JUMP_POWER_MIN
    p.grounded = false
    p.onPlatformId = null
    p.anim = 'jumping'
    p.doubleJumpAvailable = true
    p.isHoldingJump = false
    return
  }

  // Double-jump: tap while in the air (no coyote available)
  if (!p.grounded && p.doubleJumpAvailable) {
    p.vy = -JUMP_POWER_MIN * 0.85  // slightly weaker than ground jump
    p.doubleJumpAvailable = false
    p.anim = 'jumping'
    return
  }

  // In air with no options: buffer the jump input for when we land
  if (!p.grounded && !p.doubleJumpAvailable) {
    p.jumpBufferTimer = JUMP_BUFFER_SECS
    return
  }

  // Grounded: start hold accumulation (power fires in releaseJump)
  p.isHoldingJump = true
  p.jumpHoldMs = 0
}

export function releaseJump(state: GameState): void {
  const p = state.player
  if (!p.isHoldingJump) return
  p.isHoldingJump = false

  if (!p.grounded) return

  const holdRatio = Math.min(p.jumpHoldMs / MAX_JUMP_HOLD_MS, 1)
  const power = JUMP_POWER_MIN + holdRatio * (JUMP_POWER_MAX - JUMP_POWER_MIN)
  p.vy = -power
  p.grounded = false
  p.onPlatformId = null
  p.anim = 'jumping'
  p.jumpHoldMs = 0
  p.doubleJumpAvailable = true  // can double-jump once after leaving ground
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeTargetSpeed(gameTime: number): number {
  if (gameTime < 10)  return BASE_SCROLL_SPEED
  if (gameTime < 30)  return BASE_SCROLL_SPEED + (180) * ((gameTime - 10) / 20)
  if (gameTime < 60)  return 380 + (80) * ((gameTime - 30) / 30)
  return Math.min(MAX_SCROLL_SPEED, 460 + (gameTime - 60) * 1.5)
}

/**
 * Circular player hitbox vs axis-aligned obstacle rect.
 * Clamps circle center to the nearest point on the rect, then checks distance < radius.
 * Forgives diagonal corner grazes that rect-vs-rect would falsely count as hits.
 */
function circleRectOverlap(
  cx: number,
  cy: number,
  r: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  const nearX = Math.max(rect.left, Math.min(cx, rect.right))
  const nearY = Math.max(rect.top,  Math.min(cy, rect.bottom))
  const dx = cx - nearX
  const dy = cy - nearY
  return dx * dx + dy * dy < r * r
}

function removeObstacle(state: GameState, id: number): void {
  state.obstacles = state.obstacles.filter((o) => o.id !== id)
}

function collectPickup(state: GameState, pk: { type: string; id: number; collected: boolean }): void {
  pk.collected = true
  state.pickupsCollected++

  if (pk.type === 'essence') {
    state.score += 1
    state.currentCombo++
    state.longestCombo = Math.max(state.longestCombo, state.currentCombo)
  } else if (pk.type === 'holocron') {
    state.score += 10
    state.currentCombo++
    state.longestCombo = Math.max(state.longestCombo, state.currentCombo)
    state.speedBoostActive = true
    state.speedBoostTimer = SPEED_BOOST_DURATION
    state.screenFlashTimer = 0.4
  } else if (pk.type === 'bibo') {
    state.player.shieldActive = true
    state.player.shieldTimer = 3.0
    state.currentCombo++
  }
}

function killPlayer(state: GameState): void {
  if (state.player.anim === 'dead') return
  state.player.anim = 'dead'
  state.player.vy = 0
  state.player.grounded = false
  state.phase = 'ended'
}
