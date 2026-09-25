// Procedural level generation. Levels are built left-to-right from chunks.

import { Rng } from "../../core/rng";

export const T = {
  AIR: 0,
  GROUND: 1,
  BRICK: 2,
  QBLOCK: 3,
  USED: 4,
  SOLID: 5,
  PIPE_TL: 6,
  PIPE_TR: 7,
  PIPE_L: 8,
  PIPE_R: 9,
  COIN: 10,
  GLITCH: 11,
} as const;

export const ROWS = 15;
export const BASE_GROUND = 13;
/** groundTop value for a pit column. */
export const PIT = 99;

export function isSolid(t: number): boolean {
  return t >= T.GROUND && t <= T.PIPE_R;
}

export interface Decor {
  kind: "cloud" | "hill" | "bush";
  /** Tile x. */
  x: number;
  /** Row the decor sits on (bottom edge), or the cloud's row. */
  y: number;
  size: number;
  /** Clouds and bushes are the same sprite in different colours; sometimes the palette slips. */
  swapped?: boolean;
}

/** A pipe you can go down (tile x of its left column, and its top row). */
export interface PipeRef {
  x: number;
  top: number;
}

export interface Level {
  number: number;
  seed: number;
  coinfill: boolean;
  /** A bonus room under a warp pipe (rather than a full level). */
  bonus: boolean;
  w: number;
  tiles: Uint8Array;
  /** Coins remaining inside ? blocks / multi-coin bricks, by tile index. */
  qcoins: Map<number, number>;
  /** Top solid row of the terrain per column (PIT for gaps). */
  groundTop: number[];
  enemies: { x: number; y: number }[];
  /** Oversight drones: patrol centre (tiles) and horizontal range (tiles). */
  drones: { x: number; y: number; range: number }[];
  /** The one pipe per level that leads to a bonus room. */
  warp: PipeRef | null;
  /** In a bonus room: the pipe that leads back out. */
  exitPipe: PipeRef | null;
  /** Tile index of the ? block holding the coin magnet, or -1. */
  magnetAt: number;
  /** Coins obtainable in the level itself: loose coins plus the contents of blocks. */
  totalCoins: number;
  /** Tile x where the princess waits between the flagpole and the castle, or -1. */
  princessX: number;
  decor: Decor[];
  spawnX: number;
  checkpointX: number;
  flagX: number;
  castleX: number;
  glitchCount: number;
}

export interface GenOpts {
  number: number;
  seed: number;
  coinfill?: boolean;
  /** Skip glitch coins entirely (e.g. the decorative instance views). */
  noGlitch?: boolean;
  /** Multiplier on enemy frequency. */
  enemyScale?: number;
}

type Spot = [number, number];

/** How the crash hazard escalates in normal mode. */
function glitchPlan(n: number): { scattered: number; inPath: number; wall: boolean } {
  if (n <= 1) return { scattered: 0, inPath: 0, wall: false };
  if (n === 2) return { scattered: 1, inPath: 0, wall: false };
  if (n === 3) return { scattered: 2, inPath: 0, wall: false };
  if (n === 4) return { scattered: 3, inPath: 1, wall: false };
  if (n === 5) return { scattered: 4, inPath: 3, wall: false };
  return { scattered: 5 + (n - 6), inPath: 4 + (n - 6), wall: true };
}

export function generateLevel(opts: GenOpts): Level {
  const n = opts.number;
  const rng = new Rng(opts.seed);
  const W = 180 + Math.min(n, 8) * 12;
  const MAXW = W + 40;
  const tiles = new Uint8Array(MAXW * ROWS);
  const groundTop: number[] = new Array(MAXW).fill(PIT);
  const qcoins = new Map<number, number>();
  const enemies: { x: number; y: number }[] = [];
  const highSpots: Spot[] = [];
  const pathSpots: Spot[] = [];
  const qSpots: number[] = [];
  const pipeSpots: PipeRef[] = [];
  const enemyScale = opts.enemyScale ?? 1;
  const difficulty = Math.min(1, (n - 1) / 6);

  const idx = (x: number, y: number) => y * MAXW + x;
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && x < MAXW && y >= 0 && y < ROWS) tiles[idx(x, y)] = t;
  };
  const get = (x: number, y: number) => (x >= 0 && x < MAXW && y >= 0 && y < ROWS ? tiles[idx(x, y)] : T.AIR);
  const ground = (x: number, gt: number) => {
    groundTop[x] = gt;
    for (let y = gt; y < ROWS; y++) set(x, y, T.GROUND);
  };
  const coin = (x: number, y: number, path = true) => {
    if (get(x, y) === T.AIR) {
      set(x, y, T.COIN);
      if (path) pathSpots.push([x, y]);
    }
  };
  const enemy = (x: number, gt: number, p = 0.5) => {
    if (rng.chance(Math.min(0.95, p * enemyScale * (0.6 + difficulty * 0.8)))) enemies.push({ x, y: gt - 1 });
  };

  let x = 0;
  let gt = BASE_GROUND;

  // Start area
  for (; x < 14; x++) ground(x, gt);
  const spawnX = 3;
  let checkpointX = 0;

  type Chunk = "flat" | "gap" | "blocks" | "pipe" | "stairs" | "platforms" | "plateau" | "coinfield" | "enemies";
  const kinds: Chunk[] = ["flat", "gap", "blocks", "pipe", "stairs", "platforms", "plateau", "coinfield", "enemies"];
  const weights = [
    2,
    1.5 + difficulty * 1.5,
    2.2,
    1.6,
    1 + difficulty,
    n >= 2 ? 0.6 + difficulty * 1.2 : 0,
    1,
    0.8,
    n >= 2 ? 0.6 + difficulty : 0.2,
  ];
  const endAt = W - 30;
  let last: Chunk | null = null;

  while (x < endAt) {
    let kind = rng.weighted(kinds, weights);
    if (kind === last && (kind === "gap" || kind === "platforms" || kind === "stairs")) kind = "flat";
    last = kind;
    if (!checkpointX && x > endAt / 2) checkpointX = x;

    switch (kind) {
      case "flat": {
        const len = rng.int(4, 9);
        for (let i = 0; i < len; i++) ground(x + i, gt);
        if (rng.chance(0.55)) {
          const row = gt - rng.int(3, 4);
          const cl = Math.min(len - 1, rng.int(3, 6));
          for (let i = 0; i < cl; i++) coin(x + 1 + i, row);
        }
        enemy(x + Math.floor(len / 2), gt, 0.35);
        x += len;
        break;
      }
      case "gap": {
        const maxGap = Math.min(4, 2 + Math.floor((n + 1) / 2));
        const w = rng.int(2, maxGap);
        ground(x, gt);
        ground(x + 1, gt);
        for (let i = 0; i < w; i++) groundTop[x + 2 + i] = PIT;
        const land = rng.chance(0.3) ? Math.max(10, Math.min(BASE_GROUND, gt + rng.int(-1, 1))) : gt;
        ground(x + 2 + w, land);
        ground(x + 3 + w, land);
        // coin arc over the gap
        for (let i = 0; i <= w + 1; i++) {
          const h = Math.round(Math.sin((Math.PI * i) / (w + 1)) * 2);
          coin(x + 1 + i, Math.min(gt, land) - 3 - h);
        }
        gt = land;
        x += 4 + w;
        break;
      }
      case "blocks": {
        const len = rng.int(8, 11);
        for (let i = 0; i < len; i++) ground(x + i, gt);
        const row = gt - 4;
        const bl = rng.int(3, 5);
        const bx = x + 2;
        let hasQ = false;
        for (let i = 0; i < bl; i++) {
          const q: boolean = rng.chance(0.45) || (!hasQ && i === bl - 1);
          hasQ ||= q;
          set(bx + i, row, q ? T.QBLOCK : T.BRICK);
          if (q) qSpots.push(idx(bx + i, row));
          if (!q && rng.chance(0.12)) qcoins.set(idx(bx + i, row), rng.int(4, 8));
          highSpots.push([bx + i, row - 1]);
        }
        if (row - 4 >= 2 && rng.chance(0.5)) {
          const ul = rng.int(1, 3);
          const ux = bx + Math.floor((bl - ul) / 2);
          for (let i = 0; i < ul; i++) {
            set(ux + i, row - 4, T.QBLOCK);
            highSpots.push([ux + i, row - 5]);
          }
        } else if (rng.chance(0.6)) {
          for (let i = 0; i < bl; i++) coin(bx + i, row - 2, false);
        }
        enemy(bx + bl, gt, 0.5);
        x += len;
        break;
      }
      case "pipe": {
        const len = rng.int(6, 9);
        for (let i = 0; i < len; i++) ground(x + i, gt);
        const ph = rng.int(2, n > 2 ? 4 : 3);
        const px = x + 2;
        const top = gt - ph;
        set(px, top, T.PIPE_TL);
        set(px + 1, top, T.PIPE_TR);
        for (let y = top + 1; y < gt; y++) {
          set(px, y, T.PIPE_L);
          set(px + 1, y, T.PIPE_R);
        }
        highSpots.push([px, top - 3], [px + 1, top - 3]);
        pipeSpots.push({ x: px, top });
        if (rng.chance(0.4)) for (let i = 0; i < 2; i++) coin(px + i, top - 2);
        enemy(px + 4, gt, 0.5);
        x += len;
        break;
      }
      case "stairs": {
        const h = rng.int(3, Math.min(5, gt - 3));
        const mode = rng.chance(0.5) ? "pyramid" : "gapped";
        const total = mode === "pyramid" ? h * 2 + 2 : h * 2 + 4;
        for (let i = 0; i < total + 2; i++) ground(x + i, gt);
        for (let i = 0; i < h; i++) for (let y = gt - 1 - i; y < gt; y++) set(x + 1 + i, y, T.SOLID);
        let downStart: number;
        if (mode === "pyramid") {
          for (let y = gt - h; y < gt; y++) {
            set(x + 1 + h, y, T.SOLID);
            set(x + 2 + h, y, T.SOLID);
          }
          downStart = x + 3 + h;
          highSpots.push([x + 1 + h, gt - h - 3], [x + 2 + h, gt - h - 3]);
        } else {
          groundTop[x + 1 + h] = PIT;
          groundTop[x + 2 + h] = PIT;
          for (let y = 0; y < ROWS; y++) {
            set(x + 1 + h, y, T.AIR);
            set(x + 2 + h, y, T.AIR);
          }
          downStart = x + 3 + h;
          highSpots.push([x + h, gt - h - 3]);
          for (let i = 0; i < 2; i++) coin(x + 1 + h + i, gt - h - 2);
        }
        for (let i = 0; i < h; i++) for (let y = gt - h + i; y < gt; y++) set(downStart + i, y, T.SOLID);
        x += total + 2;
        break;
      }
      case "platforms": {
        const span = rng.int(7, 10);
        ground(x, gt);
        ground(x + 1, gt);
        let px = x + 2;
        const end = x + 2 + span;
        for (let i = px; i < end; i++) groundTop[i] = PIT;
        px += rng.int(1, 2);
        while (px < end - 2) {
          const row = gt - rng.int(2, 4);
          const pl = 3;
          for (let i = 0; i < pl; i++) {
            set(px + i, row, T.BRICK);
            coin(px + i, row - 2);
          }
          px += pl + rng.int(2, 3);
        }
        ground(end, gt);
        ground(end + 1, gt);
        x = end + 2;
        break;
      }
      case "plateau": {
        const delta = rng.chance(0.5) ? -rng.int(1, 2) : rng.int(1, 2);
        gt = Math.max(10, Math.min(BASE_GROUND, gt + delta));
        const len = rng.int(5, 9);
        for (let i = 0; i < len; i++) ground(x + i, gt);
        enemy(x + len - 2, gt, 0.3);
        x += len;
        break;
      }
      case "coinfield": {
        const len = 9;
        for (let i = 0; i < len; i++) ground(x + i, gt);
        for (let i = 1; i < len - 1; i++) {
          coin(x + i, gt - 2);
          coin(x + i, gt - 3);
        }
        x += len;
        break;
      }
      case "enemies": {
        const len = rng.int(9, 12);
        for (let i = 0; i < len; i++) ground(x + i, gt);
        const count = rng.int(2, 3);
        for (let i = 0; i < count; i++) enemies.push({ x: x + 3 + i * 3, y: gt - 1 });
        x += len;
        break;
      }
    }
  }

  // End: staircase, flagpole, castle.
  for (let i = 0; i < 3; i++) ground(x + i, gt);
  x += 3;
  const stairH = Math.min(8, gt - 3);
  for (let i = 0; i < stairH + 3; i++) ground(x + i, gt);
  for (let i = 0; i < stairH; i++) for (let y = gt - 1 - i; y < gt; y++) set(x + i, y, T.SOLID);
  for (let y = gt - stairH; y < gt; y++) set(x + stairH, y, T.SOLID);
  highSpots.push([x + stairH, gt - stairH - 2]);
  x += stairH + 3;
  const flagX = x + 1;
  for (let i = 0; i < 18; i++) ground(x + i, gt);
  set(flagX, gt - 1, T.SOLID);
  const castleX = flagX + 5;
  const w = castleX + 12;
  for (let i = x + 18; i < w; i++) ground(i, gt);

  const level: Level = {
    number: n,
    seed: opts.seed,
    coinfill: !!opts.coinfill,
    bonus: false,
    w,
    tiles: new Uint8Array(0),
    qcoins: new Map(),
    groundTop: groundTop.slice(0, w),
    enemies: [],
    drones: [],
    warp: null,
    exitPipe: null,
    magnetAt: -1,
    totalCoins: 0,
    princessX: flagX + 3,
    decor: [],
    spawnX,
    checkpointX: checkpointX || Math.floor(w / 2),
    flagX,
    castleX,
    glitchCount: 0,
  };

  // Enemies: drop any placed over pits or inside solids; thin out in coin-fill mode.
  level.enemies = enemies.filter((e) => {
    if (e.x < 10 || e.x >= flagX - 4) return false;
    if (groundTop[e.x] === PIT) return false;
    return !isSolid(get(e.x, e.y));
  });

  // Coin fill: every empty tile above the terrain becomes a coin.
  if (opts.coinfill) {
    for (let cx = 1; cx < flagX - 1; cx++) {
      const limit = Math.min(groundTop[cx], BASE_GROUND);
      for (let cy = 0; cy < limit; cy++) if (get(cx, cy) === T.AIR) set(cx, cy, T.COIN);
    }
  }

  // Glitch coins.
  let glitchCount = 0;
  const glitch = (gx: number, gy: number) => {
    if (gy < 1 || gx >= flagX - 2 || gx < 8) return false;
    const t = get(gx, gy);
    if (t !== T.AIR && t !== T.COIN) return false;
    set(gx, gy, T.GLITCH);
    glitchCount++;
    return true;
  };
  if (!opts.noGlitch) {
    if (opts.coinfill) {
      // Always a way out: a few anomalies, just above a standing jump's reach
      // (reachable from blocks, pipes and stairs, so leaving is a deliberate act).
      for (let gx = 30; gx < flagX - 10; gx += rng.int(22, 32)) {
        const top = Math.min(groundTop[gx], BASE_GROUND);
        glitch(gx, top - 6);
      }
    } else {
      const plan = glitchPlan(n);
      rng.shuffle(highSpots);
      let placed = 0;
      for (const [sx, sy] of highSpots) {
        if (placed >= plan.scattered) break;
        if (glitch(sx, sy)) placed++;
      }
      rng.shuffle(pathSpots);
      placed = 0;
      for (const [sx, sy] of pathSpots) {
        if (placed >= plan.inPath) break;
        if (get(sx, sy) === T.COIN && glitch(sx, sy)) placed++;
      }
      if (plan.wall) {
        // A full-height column of anomalies across solid ground: unavoidable.
        let wx = Math.floor(w * 0.5);
        while (wx < flagX - 12 && (groundTop[wx] === PIT || groundTop[wx + 1] === PIT || isSolid(get(wx, groundTop[wx] - 1))))
          wx++;
        for (const cx of [wx, wx + 1]) {
          for (let cy = 0; cy < groundTop[cx]; cy++) {
            const t = get(cx, cy);
            if (t === T.AIR || t === T.COIN) {
              set(cx, cy, T.GLITCH);
              glitchCount++;
            }
          }
        }
        level.enemies = level.enemies.filter((e) => Math.abs(e.x - wx) > 3);
      }
    }
  }
  level.glitchCount = glitchCount;

  // One warp pipe per normal level: a short one, away from the start and the finish.
  if (!opts.coinfill) {
    const ok = pipeSpots.filter((pp) => pp.x > 18 && pp.x < flagX - 16 && groundTop[pp.x] - pp.top <= 3);
    if (ok.length) level.warp = rng.pick(ok);
  }

  // One ? block per level holds the coin magnet.
  const magnetCandidates = qSpots.filter((i) => {
    const mx = i % MAXW;
    return mx > 12 && mx < flagX - 20 && tiles[i] === T.QBLOCK;
  });
  const magnetAtMax = magnetCandidates.length ? rng.pick(magnetCandidates) : -1;

  // Oversight drones, from level 2: hovering over flat ground, and over gaps from level 4.
  const droneCount = opts.coinfill || enemyScale < 0.5 ? 0 : Math.min(3, Math.floor(n / 2));
  for (let k = 0, tries = 0; k < droneCount && tries < 60; tries++) {
    const dx = rng.int(24, flagX - 20);
    const g = groundTop[dx];
    const overGap = g === PIT;
    if (overGap && n < 4) continue;
    if (!overGap && [1, 2, 3].some((o) => groundTop[dx + o] !== g || groundTop[dx - o] !== g)) continue;
    if (level.drones.some((d) => Math.abs(d.x - dx) < 14)) continue;
    let clear = true;
    // Over gaps they hover high enough that a normal jump clears them; a running jump may not.
    const rowC = overGap ? BASE_GROUND - 7 : g - rng.int(4, 5);
    for (let yy = rowC - 1; yy <= rowC + 1; yy++) for (let xx = dx - 3; xx <= dx + 3; xx++) if (isSolid(get(xx, yy))) clear = false;
    if (!clear) continue;
    level.drones.push({ x: dx, y: rowC, range: overGap ? 1.5 : rng.int(2, 3) });
    k++;
  }

  // Compact tiles to the final width.
  level.tiles = new Uint8Array(w * ROWS);
  for (let yy = 0; yy < ROWS; yy++) for (let xx = 0; xx < w; xx++) level.tiles[yy * w + xx] = tiles[yy * MAXW + xx];
  qcoins.forEach((v, k) => {
    const yy = Math.floor(k / MAXW);
    const xx = k % MAXW;
    if (xx < w) level.qcoins.set(yy * w + xx, v);
  });
  if (magnetAtMax >= 0) level.magnetAt = Math.floor(magnetAtMax / MAXW) * w + (magnetAtMax % MAXW);
  level.totalCoins = countCoins(level);

  // Decor
  for (let dx = rng.int(2, 8); dx < w; dx += rng.int(7, 15)) {
    level.decor.push({ kind: "cloud", x: dx, y: rng.int(1, 5), size: rng.int(1, 3) });
  }
  for (let dx = rng.int(0, 10); dx < w - 8; dx += rng.int(16, 30)) {
    if (groundTop[dx] !== PIT && groundTop[dx + 4] === groundTop[dx])
      level.decor.push({ kind: "hill", x: dx, y: groundTop[dx], size: rng.int(1, 2) });
  }
  for (let dx = rng.int(4, 12); dx < w - 4; dx += rng.int(9, 18)) {
    const g = groundTop[dx];
    if (g !== PIT && groundTop[dx + 3] === g) level.decor.push({ kind: "bush", x: dx, y: g, size: rng.int(1, 3) });
  }
  // About once a level, a cloud comes out green or a bush comes out white.
  const clouds = level.decor.filter((d) => d.kind === "cloud" && d.x > 16);
  const bushes = level.decor.filter((d) => d.kind === "bush" && d.x > 16 && d.x < flagX - 4);
  if (clouds.length && rng.chance(0.55)) rng.pick(clouds).swapped = true;
  if (bushes.length && rng.chance(0.55)) rng.pick(bushes).swapped = true;

  return level;
}

/** Loose coins plus everything that comes out of ? blocks and coin bricks (not the magnet). */
function countCoins(level: Level): number {
  let n = 0;
  level.tiles.forEach((t, i) => {
    if (t === T.COIN) n++;
    else if (t === T.QBLOCK && !level.qcoins.has(i) && i !== level.magnetAt) n++;
  });
  level.qcoins.forEach((v) => (n += v));
  return n;
}

/**
 * The room under a warp pipe: one screen of stone, no hazards, a lot of coins, and a pipe
 * back out. The player drops in through a gap in the ceiling at the left.
 */
export function generateBonusRoom(seed: number): Level {
  const rng = new Rng(seed ^ 0xb0b);
  const w = 26;
  const tiles = new Uint8Array(w * ROWS);
  const set = (x: number, y: number, t: number) => (tiles[y * w + x] = t);
  for (let x = 0; x < w; x++) {
    for (let y = BASE_GROUND; y < ROWS; y++) set(x, y, T.GROUND);
    set(x, 0, T.SOLID);
    set(x, 1, T.SOLID);
  }
  for (let y = 0; y < BASE_GROUND; y++) {
    set(0, y, T.SOLID);
    set(w - 1, y, T.SOLID);
  }
  // entrance: a gap in the ceiling above the left end
  set(2, 0, T.AIR);
  set(2, 1, T.AIR);
  set(3, 0, T.AIR);
  set(3, 1, T.AIR);

  // exit pipe on the right
  const exit: PipeRef = { x: w - 4, top: BASE_GROUND - 2 };
  set(exit.x, exit.top, T.PIPE_TL);
  set(exit.x + 1, exit.top, T.PIPE_TR);
  set(exit.x, exit.top + 1, T.PIPE_L);
  set(exit.x + 1, exit.top + 1, T.PIPE_R);

  // coins: a few blocks of them, reachable by jumping, plus a ledge with a row on top
  const pattern = rng.int(0, 2);
  for (let x = 5; x < w - 6; x++) {
    for (let y = 7; y <= 11; y++) {
      const on = pattern === 0 ? true : pattern === 1 ? (x + y) % 2 === 0 || y >= 10 : y !== 9 || x % 3 !== 0;
      if (on) set(x, y, T.COIN);
    }
  }
  const ledge = rng.int(7, w - 11);
  for (let x = ledge; x < ledge + 4; x++) {
    set(x, 5, T.SOLID);
    set(x, 4, T.COIN);
    set(x, 3, T.COIN);
  }

  const level: Level = {
    number: 0,
    seed,
    coinfill: false,
    bonus: true,
    w,
    tiles,
    qcoins: new Map(),
    groundTop: new Array(w).fill(BASE_GROUND),
    enemies: [],
    drones: [],
    warp: null,
    exitPipe: exit,
    magnetAt: -1,
    totalCoins: 0,
    princessX: -1,
    decor: [],
    spawnX: 2,
    checkpointX: 2,
    flagX: w + 100,
    castleX: w + 200,
    glitchCount: 0,
  };
  level.totalCoins = countCoins(level);
  return level;
}
