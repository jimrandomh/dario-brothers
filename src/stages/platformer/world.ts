// Game simulation: player physics, enemies, items, blocks, coins. No rendering, no DOM.

import { type Level, T, ROWS, PIT, isSolid } from "./levelgen";
import { TS } from "./sprites";

export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
  /** True only on the step the jump key went down. */
  jumpPressed: boolean;
  /** Held: enter pipes. */
  down?: boolean;
  /** Held: run. */
  run?: boolean;
}

export const NO_INPUT: Input = { left: false, right: false, jump: false, jumpPressed: false };

interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export type PlayerState = "play" | "dead" | "flag" | "walkout" | "done" | "pipeIn" | "pipeOut";

export interface Player extends Body {
  onGround: boolean;
  facing: 1 | -1;
  coyote: number;
  jumpBuf: number;
  jumping: boolean;
  runPhase: number;
  skidding: boolean;
  state: PlayerState;
  stateT: number;
  /** While entering/leaving a pipe: pixels below this y are hidden inside it. */
  clipY?: number;
}

export type EnemyKind = "bug" | "drone";

export interface Enemy extends Body {
  kind: EnemyKind;
  alive: boolean;
  active: boolean;
  squishT: number;
  walkPhase: number;
  /** Drones: patrol centre (px), horizontal range (px) and phase. */
  baseX: number;
  baseY: number;
  range: number;
  phase: number;
}

export interface Item extends Body {
  kind: "magnet";
  /** Seconds left rising out of its block (drawn behind the block meanwhile). */
  emerging: number;
}

export interface Particle {
  kind: "coinpop" | "sparkle" | "text" | "dust" | "debris";
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  text?: string;
  color?: string;
}

/** A coin pulled out of its tile by the magnet, flying toward the player. */
export interface FlyCoin {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface WorldEvents {
  coin?: (n: number) => void;
  glitch?: (tx: number, ty: number) => void;
  death?: (cause: "enemy" | "pit") => void;
  flag?: (bonus: number) => void;
  levelDone?: () => void;
  blockHit?: (kind: "qblock" | "brick") => void;
  brickBreak?: () => void;
  bump?: () => void;
  stomp?: (kind: EnemyKind) => void;
  jump?: () => void;
  itemSpawn?: (kind: "magnet") => void;
  powerup?: (kind: "magnet") => void;
  /** Finished sinking into a pipe: the warp pipe (main level) or the exit pipe (bonus room). */
  pipe?: () => void;
  land?: () => void;
}

// Physics tuning (pixels, seconds). Max jump ≈ 4.5–4.9 tiles walking, ~5.3 running.
const G_RISE_HOLD = 950;
const G_RISE = 2800;
const G_FALL = 1900;
const MAX_FALL = 460;
const JUMP_V = 370;
const ACCEL = 900;
const RUN_ACCEL = 1150;
const AIR_ACCEL = 650;
const FRICTION = 1300;
const MAX_WALK = 140;
const MAX_RUN = 205;
const COYOTE = 0.08;
const JUMP_BUF = 0.12;
const STOMP_BOUNCE = 250;
const ENEMY_SPEED = 32;
const ITEM_SPEED = 58;
export const MAGNET_SECONDS = 10;
const MAGNET_RADIUS = 4.2 * TS;
const PIPE_SECONDS = 0.7;
const STEP = 1 / 120;

export class World {
  level: Level;
  events: WorldEvents;
  player!: Player;
  enemies: Enemy[] = [];
  items: Item[] = [];
  particles: Particle[] = [];
  flyCoins: FlyCoin[] = [];
  /** Tile index → remaining bump animation time. */
  bumps = new Map<number, number>();
  /** Flag cloth y (px). */
  flagY = 0;
  frozen = false;
  time = 0;
  checkpointReached = false;
  /** Seconds of coin magnet remaining. */
  magnetT = 0;
  private acc = 0;
  private dustT = 0;

  constructor(level: Level, events: WorldEvents = {}) {
    this.level = level;
    this.events = events;
    this.enemies = [
      ...level.enemies.map((e) => this.makeBug(e.x, e.y)),
      ...level.drones.map((d) => this.makeDrone(d.x, d.y, d.range)),
    ];
    this.flagY = 3 * TS;
    this.spawn(false);
  }

  get poleX(): number {
    return this.level.flagX * TS + 7;
  }

  get castleDoorX(): number {
    return (this.level.castleX + 2) * TS + 8;
  }

  private makeBug(tx: number, ty: number): Enemy {
    return {
      kind: "bug", x: tx * TS + 1, y: ty * TS + 3, w: 14, h: 13, vx: -ENEMY_SPEED, vy: 0,
      alive: true, active: false, squishT: 0, walkPhase: 0, baseX: 0, baseY: 0, range: 0, phase: 0,
    };
  }

  private makeDrone(tx: number, ty: number, range: number): Enemy {
    const baseX = tx * TS + 2;
    const baseY = ty * TS + 3;
    return {
      kind: "drone", x: baseX, y: baseY, w: 12, h: 10, vx: 0, vy: 0,
      alive: true, active: false, squishT: 0, walkPhase: 0, baseX, baseY, range: range * TS, phase: (tx * 1.7) % 6.28,
    };
  }

  spawn(atCheckpoint: boolean): void {
    let tx = atCheckpoint && this.checkpointReached ? this.level.checkpointX : this.level.spawnX;
    while (this.level.groundTop[tx] === PIT) tx++;
    let gy = this.level.groundTop[tx];
    // stand on top of anything solid in the spawn column
    for (let y = 0; y < gy; y++) {
      if (isSolid(this.tileAt(tx, y))) {
        gy = y;
        break;
      }
    }
    this.player = {
      x: tx * TS + 2,
      y: gy * TS - 15,
      w: 12,
      h: 15,
      vx: 0,
      vy: 0,
      onGround: true,
      facing: 1,
      coyote: 0,
      jumpBuf: 0,
      jumping: false,
      runPhase: 0,
      skidding: false,
      state: "play",
      stateT: 0,
    };
    // clear enemies right around the spawn point
    this.enemies = this.enemies.filter((e) => Math.abs(e.x - this.player.x) > 5 * TS || !e.alive);
  }

  /** Put the player inside a pipe (tile x of its left column, top row) and have them rise out. */
  emergeFromPipe(px: number, top: number): void {
    const p = this.player;
    p.x = px * TS + TS - p.w / 2;
    p.y = top * TS;
    p.vx = 0;
    p.vy = 0;
    p.state = "pipeOut";
    p.stateT = 0;
    p.clipY = top * TS;
  }

  // ------------------------------------------------------------------ tiles

  tileAt(tx: number, ty: number): number {
    if (tx < 0 || tx >= this.level.w) return T.SOLID;
    if (ty < 0 || ty >= ROWS) return T.AIR;
    return this.level.tiles[ty * this.level.w + tx];
  }

  setTile(tx: number, ty: number, t: number): void {
    if (tx < 0 || tx >= this.level.w || ty < 0 || ty >= ROWS) return;
    this.level.tiles[ty * this.level.w + tx] = t;
  }

  private solid(tx: number, ty: number): boolean {
    return isSolid(this.tileAt(tx, ty));
  }

  private moveX(b: Body, dx: number): boolean {
    b.x += dx;
    const top = Math.floor(b.y / TS);
    const bottom = Math.floor((b.y + b.h - 0.01) / TS);
    if (dx > 0) {
      const tx = Math.floor((b.x + b.w - 0.01) / TS);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.solid(tx, ty)) {
          b.x = tx * TS - b.w;
          return true;
        }
      }
    } else if (dx < 0) {
      const tx = Math.floor(b.x / TS);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.solid(tx, ty)) {
          b.x = (tx + 1) * TS;
          return true;
        }
      }
    }
    return false;
  }

  /** Returns 1 if landed, -1 if hit head (with the struck tile columns), 0 otherwise. */
  private moveY(b: Body, dy: number): { dir: number; cols: number[]; row: number } {
    b.y += dy;
    const left = Math.floor(b.x / TS);
    const right = Math.floor((b.x + b.w - 0.01) / TS);
    const cols: number[] = [];
    if (dy > 0) {
      const ty = Math.floor((b.y + b.h - 0.01) / TS);
      for (let tx = left; tx <= right; tx++) if (this.solid(tx, ty)) cols.push(tx);
      if (cols.length) {
        b.y = ty * TS - b.h;
        return { dir: 1, cols, row: ty };
      }
    } else if (dy < 0) {
      const ty = Math.floor(b.y / TS);
      for (let tx = left; tx <= right; tx++) if (this.solid(tx, ty)) cols.push(tx);
      if (cols.length) {
        b.y = (ty + 1) * TS;
        return { dir: -1, cols, row: ty };
      }
    }
    return { dir: 0, cols, row: 0 };
  }

  // ------------------------------------------------------------------ update

  update(dt: number, input: Input): void {
    if (this.frozen) return;
    this.acc += Math.min(dt, 0.1);
    let first = true;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP, first ? input : { ...input, jumpPressed: false });
      first = false;
      if (this.frozen) break;
    }
  }

  private step(dt: number, input: Input): void {
    this.time += dt;
    const p = this.player;
    p.stateT += dt;

    switch (p.state) {
      case "play":
        this.stepPlayer(dt, input);
        break;
      case "dead":
        if (p.stateT > 0.45) {
          if (p.vy === 0 && p.stateT < 0.5) p.vy = -330;
          p.vy = Math.min(MAX_FALL, p.vy + G_FALL * 0.6 * dt);
          p.y += p.vy * dt;
        }
        break;
      case "pipeIn":
        p.y += (TS * 2.2 * dt) / PIPE_SECONDS;
        if (p.stateT >= PIPE_SECONDS) {
          p.state = "done";
          p.stateT = 0;
          this.events.pipe?.();
        }
        break;
      case "pipeOut":
        p.y -= (TS * dt) / (PIPE_SECONDS * 0.8);
        if (p.y + p.h <= (p.clipY ?? p.y + p.h)) {
          p.y = (p.clipY ?? p.y + p.h) - p.h;
          p.state = "play";
          p.stateT = 0;
          p.clipY = undefined;
          p.onGround = true;
        }
        break;
      case "flag": {
        const baseY = (this.level.groundTop[this.level.flagX] - 1) * TS;
        p.vx = 0;
        if (p.y + p.h < baseY) p.y = Math.min(baseY - p.h, p.y + 150 * dt);
        const flagBottom = baseY - 16;
        this.flagY = Math.min(flagBottom, this.flagY + 150 * dt);
        if (p.y + p.h >= baseY && this.flagY >= flagBottom && p.stateT > 0.4) {
          p.state = "walkout";
          p.stateT = 0;
          p.x = this.poleX + 3;
          p.facing = 1;
        }
        break;
      }
      case "walkout": {
        p.vx = 70;
        p.vy = Math.min(MAX_FALL, p.vy + G_FALL * dt);
        this.moveX(p, p.vx * dt);
        const r = this.moveY(p, p.vy * dt);
        p.onGround = r.dir === 1;
        if (p.onGround) p.vy = 0;
        p.runPhase += dt * 10;
        if (p.x >= this.castleDoorX - 6) {
          p.state = "done";
          p.stateT = 0;
          this.events.levelDone?.();
        }
        break;
      }
      case "done":
        break;
    }

    if (this.magnetT > 0) {
      this.magnetT = Math.max(0, this.magnetT - dt);
      if (p.state === "play") this.pullCoins();
    }
    this.stepFlyCoins(dt);
    this.stepEnemies(dt);
    this.stepItems(dt);
    this.stepParticles(dt);
    this.bumps.forEach((t, k) => {
      const nt = t - dt;
      if (nt <= 0) this.bumps.delete(k);
      else this.bumps.set(k, nt);
    });
  }

  private stepPlayer(dt: number, input: Input): void {
    const p = this.player;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const maxSpeed = input.run ? MAX_RUN : MAX_WALK;
    const accel = p.onGround ? (input.run ? RUN_ACCEL : ACCEL) : AIR_ACCEL;
    p.skidding = false;
    const speedBefore = Math.abs(p.vx);
    if (dir !== 0) {
      p.vx += dir * accel * dt;
      if (Math.sign(p.vx) !== dir && p.onGround) {
        p.vx += dir * FRICTION * dt;
        p.skidding = Math.abs(p.vx) > 70;
      }
      p.facing = dir as 1 | -1;
    } else if (p.onGround) {
      const f = FRICTION * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    } else {
      p.vx *= 1 - 0.8 * dt;
    }
    // Cap at walking/running speed. Above the cap (just after letting go of run), speed may
    // only bleed off gradually from where it was, rather than snapping to walking pace.
    const limit = Math.max(maxSpeed, speedBefore - 500 * dt);
    if (Math.abs(p.vx) > limit) p.vx = Math.sign(p.vx) * limit;

    if (p.skidding) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.07;
        this.dust(p.x + p.w / 2 - p.facing * 5, p.y + p.h, -p.facing * 20);
      }
    }

    if (input.jumpPressed) p.jumpBuf = JUMP_BUF;
    else p.jumpBuf -= dt;
    if (p.onGround) p.coyote = COYOTE;
    else p.coyote -= dt;
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = -(JUMP_V + Math.abs(p.vx) * 0.12);
      p.jumping = true;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      this.events.jump?.();
    }

    const g = p.vy < 0 ? (input.jump && p.jumping ? G_RISE_HOLD : G_RISE) : G_FALL;
    p.vy = Math.min(MAX_FALL, p.vy + g * dt);

    const fallSpeed = p.vy;
    if (this.moveX(p, p.vx * dt)) p.vx = 0;
    const r = this.moveY(p, p.vy * dt);
    const wasGround = p.onGround;
    p.onGround = false;
    if (r.dir === 1) {
      p.onGround = true;
      p.vy = 0;
      p.jumping = false;
      if (!wasGround && fallSpeed > 300) {
        this.dust(p.x + 1, p.y + p.h, -25);
        this.dust(p.x + p.w - 1, p.y + p.h, 25);
        this.events.land?.();
      }
    } else if (r.dir === -1) {
      p.vy = 40;
      p.jumping = false;
      const cx = p.x + p.w / 2;
      let best = r.cols[0];
      for (const c of r.cols) if (Math.abs(c * TS + 8 - cx) < Math.abs(best * TS + 8 - cx)) best = c;
      this.hitBlock(best, r.row);
    }

    if (p.onGround && Math.abs(p.vx) > 5) p.runPhase += (Math.abs(p.vx) / MAX_WALK) * dt * 14;
    else if (p.onGround) p.runPhase = 0;

    if (!this.checkpointReached && p.x > this.level.checkpointX * TS) this.checkpointReached = true;

    // pipes: standing on the warp pipe (or the bonus room's exit pipe) and pressing down
    const pipe = this.level.warp ?? this.level.exitPipe;
    if (pipe && input.down && p.onGround && Math.abs(p.y + p.h - pipe.top * TS) < 1) {
      const centre = p.x + p.w / 2;
      if (centre > pipe.x * TS + 5 && centre < (pipe.x + 2) * TS - 5) {
        p.state = "pipeIn";
        p.stateT = 0;
        p.vx = 0;
        p.x = pipe.x * TS + TS - p.w / 2;
        p.clipY = pipe.top * TS;
        return;
      }
    }

    // coins & anomalies
    const x0 = Math.floor((p.x + 1) / TS);
    const x1 = Math.floor((p.x + p.w - 1) / TS);
    const y0 = Math.floor((p.y + 1) / TS);
    const y1 = Math.floor((p.y + p.h - 1) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === T.COIN) {
          this.setTile(tx, ty, T.AIR);
          this.particles.push({ kind: "sparkle", x: tx * TS + 8, y: ty * TS + 8, vx: 0, vy: 0, t: 0, life: 0.25 });
          this.events.coin?.(1);
        } else if (t === T.GLITCH) {
          this.frozen = true;
          this.events.glitch?.(tx, ty);
          return;
        }
      }
    }

    if (p.y > ROWS * TS + 8) {
      this.kill("pit");
      return;
    }

    // flagpole
    if (p.x + p.w >= this.level.flagX * TS - 0.5) {
      p.state = "flag";
      p.stateT = 0;
      p.x = this.poleX - p.w + 2;
      p.vy = 0;
      p.vx = 0;
      p.facing = 1;
      const baseY = (this.level.groundTop[this.level.flagX] - 1) * TS;
      const bonus = Math.max(1, Math.min(8, Math.round((baseY - (p.y + p.h)) / 16)));
      this.particles.push({ kind: "text", x: p.x + 8, y: p.y - 4, vx: 0, vy: -20, t: 0, life: 1.4, text: `+${bonus}`, color: "#ffd23f" });
      this.events.flag?.(bonus);
    }
  }

  kill(cause: "enemy" | "pit"): void {
    const p = this.player;
    if (p.state !== "play") return;
    p.state = "dead";
    p.stateT = 0;
    p.vx = 0;
    p.vy = 0;
    this.magnetT = 0;
    this.events.death?.(cause);
  }

  private dust(x: number, y: number, vx: number): void {
    this.particles.push({ kind: "dust", x, y: y - 2, vx, vy: -18, t: 0, life: 0.35 });
  }

  private hitBlock(tx: number, ty: number): void {
    const t = this.tileAt(tx, ty);
    const i = ty * this.level.w + tx;
    const inside = this.level.qcoins.get(i);
    if (t === T.QBLOCK && i === this.level.magnetAt) {
      // the power-up block: a magnet rises out instead of a coin
      this.level.magnetAt = -1;
      this.setTile(tx, ty, T.USED);
      this.bumps.set(i, 0.15);
      this.items.push({ kind: "magnet", x: tx * TS + 2, y: ty * TS + 4, w: 12, h: 12, vx: ITEM_SPEED, vy: 0, emerging: 0.55 });
      this.events.itemSpawn?.("magnet");
      this.bonkEnemiesOn(tx, ty);
    } else if (t === T.QBLOCK || (t === T.BRICK && inside !== undefined)) {
      const left = (inside ?? 1) - 1;
      if (left <= 0) {
        this.level.qcoins.delete(i);
        this.setTile(tx, ty, T.USED);
      } else {
        this.level.qcoins.set(i, left);
      }
      this.bumps.set(i, 0.15);
      this.particles.push({ kind: "coinpop", x: tx * TS + 8, y: ty * TS - 8, vx: 0, vy: -280, t: 0, life: 0.5 });
      this.events.coin?.(1);
      this.events.blockHit?.(t === T.QBLOCK ? "qblock" : "brick");
      this.bonkEnemiesOn(tx, ty);
    } else if (t === T.BRICK) {
      // plain bricks shatter
      this.bonkEnemiesOn(tx, ty);
      this.setTile(tx, ty, T.AIR);
      for (const [dx, dy, vx, vy] of [
        [3, 3, -70, -320],
        [11, 3, 70, -320],
        [3, 11, -55, -220],
        [11, 11, 55, -220],
      ]) {
        this.particles.push({ kind: "debris", x: tx * TS + dx, y: ty * TS + dy, vx, vy, t: 0, life: 1.2 });
      }
      this.events.brickBreak?.();
    } else {
      this.events.bump?.();
    }
  }

  private bonkEnemiesOn(tx: number, ty: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.kind !== "bug") continue;
      const onTop = Math.abs(e.y + e.h - ty * TS) < 3 && e.x + e.w > tx * TS && e.x < (tx + 1) * TS;
      if (onTop) {
        e.alive = false;
        e.squishT = 0.5;
        this.events.stomp?.("bug");
      }
    }
    for (const it of this.items) {
      const onTop = Math.abs(it.y + it.h - ty * TS) < 3 && it.x + it.w > tx * TS && it.x < (tx + 1) * TS;
      if (onTop && it.emerging <= 0) {
        it.vy = -260;
        it.vx = it.x + it.w / 2 < tx * TS + 8 ? -ITEM_SPEED : ITEM_SPEED;
      }
    }
  }

  // ------------------------------------------------------------------ magnet

  private pullCoins(): void {
    const p = this.player;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const r = Math.ceil(MAGNET_RADIUS / TS);
    const tx0 = Math.floor(cx / TS) - r;
    const ty0 = Math.floor(cy / TS) - r;
    for (let ty = Math.max(0, ty0); ty <= ty0 + 2 * r && ty < ROWS; ty++) {
      for (let tx = Math.max(0, tx0); tx <= tx0 + 2 * r && tx < this.level.w; tx++) {
        if (this.tileAt(tx, ty) !== T.COIN) continue;
        const dx = tx * TS + 8 - cx;
        const dy = ty * TS + 8 - cy;
        if (dx * dx + dy * dy > MAGNET_RADIUS * MAGNET_RADIUS) continue;
        this.setTile(tx, ty, T.AIR);
        this.flyCoins.push({ x: tx * TS + 8, y: ty * TS + 8, vx: -dy * 1.5, vy: dx * 1.5 });
      }
    }
  }

  private stepFlyCoins(dt: number): void {
    if (!this.flyCoins.length) return;
    const p = this.player;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const alive = p.state === "play" || p.state === "flag" || p.state === "walkout";
    this.flyCoins = this.flyCoins.filter((c) => {
      const dx = cx - c.x;
      const dy = cy - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 9 && alive) {
        this.particles.push({ kind: "sparkle", x: c.x, y: c.y, vx: 0, vy: 0, t: 0, life: 0.2 });
        this.events.coin?.(1);
        return false;
      }
      const a = 2600;
      c.vx = (c.vx + (dx / d) * a * dt) * (1 - 3 * dt);
      c.vy = (c.vy + (dy / d) * a * dt) * (1 - 3 * dt);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      return true;
    });
  }

  // ------------------------------------------------------------------ items

  private stepItems(dt: number): void {
    const p = this.player;
    for (const it of this.items) {
      if (it.emerging > 0) {
        it.emerging -= dt;
        it.y -= (TS * dt) / 0.55;
        continue;
      }
      it.vy = Math.min(MAX_FALL, it.vy + G_FALL * dt);
      if (this.moveX(it, it.vx * dt)) it.vx = -it.vx;
      const r = this.moveY(it, it.vy * dt);
      if (r.dir !== 0) it.vy = 0;
      if (p.state === "play" && overlap(p, it)) {
        it.y = 9999;
        this.magnetT = MAGNET_SECONDS;
        this.particles.push({ kind: "text", x: p.x + 6, y: p.y - 6, vx: 0, vy: -24, t: 0, life: 1.2, text: "MAGNET", color: "#ff6a5a" });
        this.events.powerup?.("magnet");
      }
    }
    this.items = this.items.filter((it) => it.y < ROWS * TS + 32);
  }

  // ------------------------------------------------------------------ enemies

  private stepEnemies(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) {
        e.squishT -= dt;
        if (e.kind === "drone") {
          // knocked out of the air: tumble down off the screen
          e.vy = Math.min(MAX_FALL, e.vy + G_FALL * dt);
          e.y += e.vy * dt;
          e.walkPhase += dt * 12;
        }
        continue;
      }
      if (!e.active) {
        if (Math.abs(e.x - p.x) < 20 * TS) e.active = true;
        else continue;
      }
      if (e.kind === "drone") {
        const t = this.time + e.phase;
        const nx = e.baseX + Math.sin(t * 0.7) * e.range;
        e.vx = (nx - e.x) / dt;
        e.x = nx;
        e.y = e.baseY + Math.sin(t * 2.3) * 7;
        e.walkPhase += dt * 20;
      } else {
        e.vy = Math.min(MAX_FALL, e.vy + G_FALL * dt);
        if (this.moveX(e, e.vx * dt)) e.vx = -e.vx;
        const r = this.moveY(e, e.vy * dt);
        if (r.dir === 1) e.vy = 0;
        e.walkPhase += dt * 6;
        if (e.y > ROWS * TS + 32) e.alive = false;
      }

      if (p.state === "play" && overlap(p, e)) {
        const fromAbove = p.vy > 0 && p.y + p.h - e.y < 9;
        if (fromAbove) {
          e.alive = false;
          e.squishT = e.kind === "drone" ? 2 : 0.5;
          e.vy = e.kind === "drone" ? -60 : 0;
          p.vy = -STOMP_BOUNCE;
          p.jumping = true;
          this.particles.push({ kind: "dust", x: e.x + e.w / 2, y: e.y + 2, vx: 0, vy: -10, t: 0, life: 0.3 });
          this.events.stomp?.(e.kind);
        } else {
          this.kill("enemy");
        }
      }
    }
    // bugs bounce off each other
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a.alive || !a.active || a.kind !== "bug") continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b.alive || !b.active || b.kind !== "bug" || !overlap(a, b)) continue;
        if (a.x < b.x) {
          a.vx = -Math.abs(a.vx);
          b.vx = Math.abs(b.vx);
        } else {
          a.vx = Math.abs(a.vx);
          b.vx = -Math.abs(b.vx);
        }
      }
    }
    if (this.enemies.some((e) => !e.alive && e.squishT <= 0)) {
      this.enemies = this.enemies.filter((e) => e.alive || e.squishT > 0);
    }
  }

  private stepParticles(dt: number): void {
    for (const pt of this.particles) {
      pt.t += dt;
      if (pt.kind === "coinpop") {
        pt.vy += 900 * dt;
        pt.y += pt.vy * dt;
        if (pt.t >= pt.life) {
          this.particles.push({ kind: "text", x: pt.x, y: pt.y, vx: 0, vy: -30, t: 0, life: 0.6, text: "+1", color: "#fff" });
        }
      } else if (pt.kind === "text") {
        pt.y += pt.vy * dt;
      } else if (pt.kind === "debris") {
        pt.vy += 1400 * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      } else if (pt.kind === "dust") {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }
    }
    this.particles = this.particles.filter((pt) => pt.t < pt.life && pt.y < ROWS * TS + 40);
  }
}

function overlap(a: Body, b: Body): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
