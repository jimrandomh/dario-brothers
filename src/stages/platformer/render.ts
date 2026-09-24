// Draws a World into a low-resolution buffer (VIEW_H px tall, variable width).

import { getSheet, TS, type Sheet } from "./sprites";
import { T, ROWS } from "./levelgen";
import type { World } from "./world";
import { rng } from "../../core/rng";

export const VIEW_H = ROWS * TS; // 240

export interface RenderOpts {
  /** 0..1 — how much the environment is visibly coming apart. */
  corruption: number;
  /** Tile index of a normal coin to draw as an anomaly for a moment (foreshadowing). */
  flickerTile?: number;
  sky?: string;
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function renderWorld(g: CanvasRenderingContext2D, world: World, camX: number, viewW: number, opts: RenderOpts): void {
  const s = getSheet();
  const lvl = world.level;
  const t = world.time;
  const cx = Math.round(camX);

  g.fillStyle = opts.sky ?? "#6a9cff";
  g.fillRect(0, 0, viewW, VIEW_H);

  // clouds (parallax), then hills & bushes
  for (const d of lvl.decor) {
    if (d.kind !== "cloud") continue;
    const img = s.clouds[d.size - 1];
    const sx = Math.round(d.x * TS - cx * 0.5);
    if (sx + img.width < 0 || sx > viewW) continue;
    g.drawImage(img, sx, d.y * TS);
  }
  for (const d of lvl.decor) {
    if (d.kind === "cloud") continue;
    const img = d.kind === "hill" ? s.hills[d.size - 1] : s.bushes[d.size - 1];
    const sx = d.x * TS - cx;
    if (sx + img.width < 0 || sx > viewW) continue;
    g.drawImage(img, sx, d.y * TS - img.height + (d.kind === "bush" ? 4 : 0));
  }

  // castle
  const castleSx = lvl.castleX * TS - cx;
  if (castleSx < viewW && castleSx + 80 > 0) {
    g.drawImage(s.castle, castleSx, lvl.groundTop[lvl.castleX] * TS - 80);
  }

  // flagpole
  const poleSx = lvl.flagX * TS + 7 - cx;
  if (poleSx > -20 && poleSx < viewW + 20) {
    const baseY = (lvl.groundTop[lvl.flagX] - 1) * TS;
    g.fillStyle = "#0e5a1a";
    g.fillRect(poleSx, 2 * TS + 6, 2, baseY - 2 * TS - 6);
    g.fillStyle = "#8ee05a";
    g.fillRect(poleSx, 2 * TS + 6, 1, baseY - 2 * TS - 6);
    g.fillStyle = "#0e5a1a";
    g.fillRect(poleSx - 2, 2 * TS, 6, 6);
    g.fillStyle = "#8ee05a";
    g.fillRect(poleSx - 1, 2 * TS + 1, 3, 3);
    g.drawImage(s.flag, poleSx - 16, Math.round(world.flagY));
  }

  // tiles
  const tx0 = Math.max(0, Math.floor(cx / TS));
  const tx1 = Math.min(lvl.w - 1, Math.floor((cx + viewW) / TS));
  const qPhase = [0, 0, 0, 1, 2, 1][Math.floor(t * 6) % 6];
  const coinFrame = Math.floor(t * 8);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * lvl.w + tx;
      const tile = lvl.tiles[i];
      if (tile === T.AIR) continue;
      let sx = tx * TS - cx;
      let sy = ty * TS;
      const bump = world.bumps.get(i);
      if (bump !== undefined) sy -= Math.round(Math.sin((bump / 0.15) * Math.PI) * 4);
      if (opts.corruption > 0.15 && tile !== T.COIN && hash(tx, ty + Math.floor(t * 2)) % 1000 < opts.corruption * 6) {
        g.drawImage(s.glitch[hash(tx, ty) % 8], sx, sy);
        continue;
      }
      drawTile(g, s, tile, tx, ty, sx, sy, lvl.tiles, lvl.w, qPhase, coinFrame, i === opts.flickerTile);
    }
  }

  // enemies
  for (const e of world.enemies) {
    const sx = Math.round(e.x - 1 - cx);
    if (sx < -16 || sx > viewW) continue;
    const img = !e.alive ? s.bug.flat : Math.floor(e.walkPhase) % 2 ? s.bug.walk1 : s.bug.walk2;
    if (!e.alive && e.squishT < 0.15 && Math.floor(t * 30) % 2) continue;
    g.save();
    if (e.vx > 0 && e.alive) {
      g.translate(sx + 16, 0);
      g.scale(-1, 1);
      g.drawImage(img, 0, Math.round(e.y - 3));
    } else {
      g.drawImage(img, sx, Math.round(e.y - 3));
    }
    g.restore();
  }

  // player
  const p = world.player;
  let frame = "stand";
  if (p.state === "dead") frame = "dead";
  else if (p.state === "flag") frame = "jump";
  else if (!p.onGround && p.state === "play") frame = "jump";
  else if (Math.abs(p.vx) > 5) frame = ["run1", "run2", "run3", "run2"][Math.floor(p.runPhase) % 4];
  const spr = s.dario[frame];
  if (p.state !== "done") g.drawImage(p.facing === 1 || frame === "dead" ? spr.r : spr.l, Math.round(p.x - 2 - cx), Math.round(p.y - 1));

  // particles
  for (const pt of world.particles) {
    const sx = Math.round(pt.x - cx);
    const sy = Math.round(pt.y);
    if (pt.kind === "coinpop") {
      g.drawImage(s.coin[Math.floor(pt.t * 20) % 4], sx - 8, sy - 8);
    } else if (pt.kind === "sparkle") {
      const k = pt.t / pt.life;
      const r = 2 + Math.round(k * 5);
      g.fillStyle = k < 0.5 ? "#fff6c0" : "#f8d830";
      g.fillRect(sx - r, sy, r * 2 + 1, 1);
      g.fillRect(sx, sy - r, 1, r * 2 + 1);
      g.fillRect(sx - 1, sy - 1, 3, 3);
    } else if (pt.kind === "text" && pt.text) {
      drawSmallText(g, pt.text, sx, sy, pt.color ?? "#fff");
    }
  }

  if (opts.corruption > 0) applyCorruption(g, viewW, opts.corruption);
}

function drawTile(
  g: CanvasRenderingContext2D,
  s: Sheet,
  tile: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  tiles: Uint8Array,
  w: number,
  qPhase: number,
  coinFrame: number,
  flicker: boolean,
): void {
  switch (tile) {
    case T.GROUND: {
      const above = ty > 0 ? tiles[(ty - 1) * w + tx] : T.AIR;
      const v = hash(tx, ty) % 4;
      g.drawImage(above === T.GROUND ? s.ground[v] : s.groundTop[v], sx, sy);
      break;
    }
    case T.BRICK:
      g.drawImage(s.brick, sx, sy);
      break;
    case T.QBLOCK:
      g.drawImage(s.qblock[qPhase], sx, sy);
      break;
    case T.USED:
      g.drawImage(s.used, sx, sy);
      break;
    case T.SOLID:
      g.drawImage(s.solid, sx, sy);
      break;
    case T.PIPE_TL:
      g.drawImage(s.pipe.TL, sx, sy);
      break;
    case T.PIPE_TR:
      g.drawImage(s.pipe.TR, sx, sy);
      break;
    case T.PIPE_L:
      g.drawImage(s.pipe.L, sx, sy);
      break;
    case T.PIPE_R:
      g.drawImage(s.pipe.R, sx, sy);
      break;
    case T.COIN:
      if (flicker) g.drawImage(s.glitch[Math.floor(Math.random() * 8)], sx, sy);
      else g.drawImage(s.coin[(coinFrame + ((tx * 3 + ty) >> 1)) % 4], sx, sy);
      break;
    case T.GLITCH: {
      const jitter = Math.random() < 0.15 ? Math.round((Math.random() - 0.5) * 4) : 0;
      g.drawImage(s.glitch[Math.floor(Math.random() * 8)], sx + jitter, sy);
      // stray pixels leaking out of the anomaly
      for (let k = 0; k < 3; k++) {
        g.fillStyle = Math.random() < 0.5 ? "#ff00dc" : "#00ffa0";
        g.fillRect(sx + Math.floor(Math.random() * 24) - 4, sy + Math.floor(Math.random() * 24) - 4, 1, 1);
      }
      break;
    }
  }
}

/** Tiny 3×5 digits/+ for floating score text. */
const SMALL: Record<string, string> = {
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "111001111100111",
  "3": "111001111001111",
  "4": "101101111001001",
  "5": "111100111001111",
  "6": "111100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001111",
  "+": "000010111010000",
};

export function drawSmallText(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  const w = text.length * 4 - 1;
  let sx = Math.round(x - w / 2);
  for (const ch of text) {
    const bits = SMALL[ch];
    if (bits) {
      for (let i = 0; i < 15; i++) {
        if (bits[i] !== "1") continue;
        g.fillStyle = "#000";
        g.fillRect(sx + (i % 3) + 1, y + Math.floor(i / 3) + 1, 1, 1);
        g.fillStyle = color;
        g.fillRect(sx + (i % 3), y + Math.floor(i / 3), 1, 1);
      }
    }
    sx += 4;
  }
}

/** Screen-space glitch effects, scaled by intensity 0..1. */
export function applyCorruption(g: CanvasRenderingContext2D, viewW: number, k: number): void {
  const canvas = g.canvas;
  // horizontal tears
  const tears = k > 0.9 ? 6 : Math.random() < k * 0.25 ? 1 + Math.floor(k * 3) : 0;
  for (let i = 0; i < tears; i++) {
    const y = Math.floor(Math.random() * VIEW_H);
    const h = 1 + Math.floor(Math.random() * (4 + k * 14));
    const dx = Math.round((Math.random() - 0.5) * (6 + k * 60));
    g.drawImage(canvas, 0, y, viewW, h, dx, y, viewW, h);
  }
  // stray pixels
  const px = Math.floor(k * k * 60);
  for (let i = 0; i < px; i++) {
    g.fillStyle = rng.pick(["#ff00dc", "#00ffa0", "#000", "#fff"]);
    g.fillRect(Math.floor(Math.random() * viewW), Math.floor(Math.random() * VIEW_H), 1 + (Math.random() < 0.2 ? 2 : 0), 1);
  }
  // blocky color smears
  if (Math.random() < k * k * 0.3) {
    g.fillStyle = rng.pick(["rgba(255,0,220,0.5)", "rgba(0,255,160,0.4)", "rgba(0,0,0,0.7)"]);
    g.fillRect(Math.floor(Math.random() * viewW), Math.floor(Math.random() * VIEW_H), 8 + Math.random() * 60, 2 + Math.random() * 10);
  }
  // brief inversion
  if (k > 0.5 && Math.random() < (k - 0.5) * 0.04) {
    g.save();
    g.globalCompositeOperation = "difference";
    g.fillStyle = "#fff";
    g.fillRect(0, 0, viewW, VIEW_H);
    g.restore();
  }
}
