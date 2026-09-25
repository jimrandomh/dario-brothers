// Draws a World into a low-resolution buffer (VIEW_H px tall, variable width).

import { getSheet, TS, type Sheet } from "./sprites";
import { T, ROWS } from "./levelgen";
import type { World } from "./world";
import type { ThemeId } from "./themes";
import { drawText, textWidth } from "./font";
import { rng } from "../../core/rng";

export const VIEW_H = ROWS * TS; // 240

export interface RenderOpts {
  /** 0..1 — how much the environment is visibly coming apart. */
  corruption: number;
  /** Tile index of a normal coin to draw as an anomaly for a moment (foreshadowing). */
  flickerTile?: number;
  /** Override the sky colour (crash flashes). */
  sky?: string;
  theme?: ThemeId;
  /** Screen shake offset in pixels. */
  shakeX?: number;
  shakeY?: number;
  /** Speech bubble over the princess. */
  princessSays?: string;
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function renderWorld(g: CanvasRenderingContext2D, world: World, camX: number, viewW: number, opts: RenderOpts): void {
  const s = getSheet(opts.theme ?? "day");
  const th = s.theme;
  const lvl = world.level;
  const t = world.time;
  const cx = Math.round(camX - (opts.shakeX ?? 0));

  // sky
  if (opts.sky) {
    g.fillStyle = opts.sky;
  } else {
    const grad = g.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, th.skyTop);
    grad.addColorStop(1, th.skyBottom);
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, viewW, VIEW_H);
  g.save();
  if (opts.shakeY) g.translate(0, Math.round(opts.shakeY));

  if (th.stars) drawStars(g, viewW, cx, t, lvl.seed);
  if (th.moon) {
    const mx = Math.round(viewW * 0.78 - cx * 0.05);
    g.fillStyle = "rgba(255,248,220,0.18)";
    blobAt(g, mx, 40, 13);
    g.fillStyle = "#f4ecd0";
    blobAt(g, mx, 40, 9);
    g.fillStyle = "#d8cfb0";
    g.fillRect(mx - 3, 36, 3, 2);
    g.fillRect(mx + 2, 42, 2, 2);
  }

  // clouds (parallax), then hills & bushes
  // A "swapped" cloud is drawn with the bush palette and vice versa: they are the same sprite.
  const canSwap = s.clouds.length > 0 && s.bushes.length > 0;
  for (const d of lvl.decor) {
    if (d.kind !== "cloud" || !s.clouds.length) continue;
    const img = (d.swapped && canSwap ? s.bushes : s.clouds)[d.size - 1];
    const sx = Math.round(d.x * TS - cx * 0.5);
    if (sx + img.width < 0 || sx > viewW) continue;
    g.drawImage(img, sx, d.y * TS);
  }
  for (const d of lvl.decor) {
    if (d.kind === "cloud") continue;
    const list = d.kind === "hill" ? s.hills : d.swapped && canSwap ? s.clouds : s.bushes;
    if (!list.length) continue;
    const img = list[d.size - 1];
    const sx = d.x * TS - cx;
    if (sx + img.width < 0 || sx > viewW) continue;
    g.drawImage(img, sx, d.y * TS - img.height + (d.kind === "bush" ? 4 : 0));
  }

  // castle
  const castleSx = lvl.castleX * TS - cx;
  if (!lvl.bonus && castleSx < viewW && castleSx + 80 > 0) {
    g.drawImage(s.castle, castleSx, lvl.groundTop[lvl.castleX] * TS - 80);
  }

  // flagpole
  const poleSx = lvl.flagX * TS + 7 - cx;
  if (!lvl.bonus && poleSx > -20 && poleSx < viewW + 20) {
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

  // the princess, waiting between the flagpole and the castle
  if (lvl.princessX >= 0) {
    const px = lvl.princessX * TS - cx;
    if (px > -40 && px < viewW + 40) {
      const top = lvl.groundTop[lvl.princessX] * TS - s.princess.height;
      g.drawImage(s.princess, px, top);
      if (opts.princessSays) drawBubble(g, opts.princessSays, px + 8, top - 4, viewW);
    }
  }

  // items rising out of their blocks are drawn behind the tiles
  for (const it of world.items) {
    if (it.emerging > 0) g.drawImage(s.magnet, Math.round(it.x - 2 - cx), Math.round(it.y - 2));
  }

  // player inside a pipe is drawn behind the pipe, clipped at its mouth
  const p = world.player;
  const inPipe = p.state === "pipeIn" || p.state === "pipeOut";
  if (inPipe) drawPlayer(g, s, world, cx);

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
      const sx = tx * TS - cx;
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

  // the warp pipe glints now and then: something in there reflects light like a coin
  if (lvl.warp) {
    const ph = t % 2.6;
    if (ph < 0.7) {
      const gx = lvl.warp.x * TS + 16 - cx + Math.round(Math.sin(t * 9) * 2);
      const gy = lvl.warp.top * TS - 3 - Math.round(ph * 22);
      const k = 1 - ph / 0.7;
      g.fillStyle = `rgba(255,246,192,${k.toFixed(2)})`;
      const r = 1 + Math.round(k * 2);
      g.fillRect(gx - r, gy, r * 2 + 1, 1);
      g.fillRect(gx, gy - r, 1, r * 2 + 1);
    }
  }

  // items out in the open
  for (const it of world.items) {
    if (it.emerging <= 0) g.drawImage(s.magnet, Math.round(it.x - 2 - cx), Math.round(it.y - 2 + Math.sin(t * 6) * 1));
  }

  // enemies
  for (const e of world.enemies) {
    const sx = Math.round(e.x - (e.kind === "drone" ? 2 : 1) - cx);
    if (sx < -16 || sx > viewW) continue;
    if (e.kind === "drone") {
      const img = Math.floor(e.walkPhase) % 2 ? s.drone.a : s.drone.b;
      g.save();
      if (!e.alive) {
        // tumbling: upside down, blinking out
        g.translate(sx + 8, Math.round(e.y - 3) + 8);
        g.rotate(e.walkPhase * 0.6);
        g.drawImage(img, -8, -8);
      } else {
        g.drawImage(img, sx, Math.round(e.y - 3));
        // its lens blinks red when it's "sampling"
        if (Math.floor(t * 2 + e.phase) % 5 === 0) {
          g.fillStyle = "rgba(255,80,80,0.35)";
          blobAt(g, sx + 8, Math.round(e.y - 3) + 10, 5);
        }
      }
      g.restore();
      continue;
    }
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
  if (!inPipe) drawPlayer(g, s, world, cx);

  // magnet: a faint ring showing its reach, and the coins it is pulling in
  if (world.magnetT > 0 && p.state === "play") {
    const pcx = Math.round(p.x + p.w / 2 - cx);
    const pcy = Math.round(p.y + p.h / 2);
    const fading = world.magnetT < 2 && Math.floor(t * 8) % 2 === 0;
    if (!fading) {
      g.strokeStyle = "rgba(255,106,90,0.35)";
      g.setLineDash([2, 4]);
      g.lineDashOffset = -t * 20;
      g.beginPath();
      g.arc(pcx + 0.5, pcy + 0.5, 4.2 * TS, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }
  for (const c of world.flyCoins) {
    g.drawImage(s.coin[Math.floor(t * 16 + c.x) % 4], Math.round(c.x - 8 - cx), Math.round(c.y - 8));
  }

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
    } else if (pt.kind === "dust") {
      const k = pt.t / pt.life;
      g.fillStyle = `rgba(235,235,225,${(0.8 * (1 - k)).toFixed(2)})`;
      blobAt(g, sx, sy, 1 + Math.round(k * 3));
    } else if (pt.kind === "debris") {
      g.fillStyle = th.brick[1];
      g.fillRect(sx - 2, sy - 2, 4, 4);
      g.fillStyle = th.brick[2];
      g.fillRect(sx - 2, sy - 2, 4, 1);
    } else if (pt.kind === "text" && pt.text) {
      if (/[A-Z]/.test(pt.text)) drawText(g, pt.text, sx, sy, { color: pt.color ?? "#fff", shadow: "#000", align: "center" });
      else drawSmallText(g, pt.text, sx, sy, pt.color ?? "#fff");
    }
  }

  g.restore();
  if (opts.corruption > 0) applyCorruption(g, viewW, opts.corruption);
}

function drawPlayer(g: CanvasRenderingContext2D, s: Sheet, world: World, cx: number): void {
  const p = world.player;
  if (p.state === "done") return;
  let frame = "stand";
  if (p.state === "dead") frame = "dead";
  else if (p.state === "flag") frame = "jump";
  else if (!p.onGround && p.state === "play") frame = "jump";
  else if (Math.abs(p.vx) > 5) frame = ["run1", "run2", "run3", "run2"][Math.floor(p.runPhase) % 4];
  const spr = s.dario[frame];
  const img = p.facing === 1 || frame === "dead" ? spr.r : spr.l;
  const dx = Math.round(p.x - 2 - cx);
  const dy = Math.round(p.y - 1);
  if (p.clipY !== undefined) {
    // only the part above the pipe's mouth is visible
    const visible = Math.max(0, Math.min(16, Math.round(p.clipY) - dy));
    if (visible > 0) g.drawImage(img, 0, 0, 16, visible, dx, dy, 16, visible);
    return;
  }
  // magnet powered: a red glint follows Dario
  if (world.magnetT > 0 && Math.floor(world.time * 10) % 3 === 0) {
    g.fillStyle = "#ff6a5a";
    g.fillRect(dx + 7 + Math.round(Math.sin(world.time * 7) * 7), dy + 2 + Math.round(Math.cos(world.time * 7) * 7), 2, 2);
  }
  g.drawImage(img, dx, dy);
}

/** A speech bubble whose tail points down at (x, bottom). */
function drawBubble(g: CanvasRenderingContext2D, text: string, x: number, bottom: number, viewW: number): void {
  const w = textWidth(text) + 8;
  const h = 13;
  const left = Math.round(Math.max(2, Math.min(viewW - w - 2, x - w / 2)));
  const top = bottom - h - 4;
  g.fillStyle = "#1a1a2a";
  g.fillRect(left - 1, top, w + 2, h);
  g.fillRect(left, top - 1, w, h + 2);
  g.fillStyle = "#ffffff";
  g.fillRect(left, top, w, h);
  // tail
  const tx = Math.round(Math.max(left + 3, Math.min(left + w - 4, x)));
  g.fillStyle = "#1a1a2a";
  g.fillRect(tx - 2, top + h, 5, 1);
  g.fillRect(tx - 1, top + h + 1, 3, 2);
  g.fillStyle = "#ffffff";
  g.fillRect(tx - 1, top + h - 1, 3, 1);
  g.fillRect(tx, top + h, 1, 2);
  drawText(g, text, left + 4, top + 3, { color: "#2a2040" });
}

function blobAt(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (let y = -r; y <= r; y++) {
    const hw = Math.round(Math.sqrt(r * r - y * y));
    g.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
  }
}

function drawStars(g: CanvasRenderingContext2D, viewW: number, cx: number, t: number, seed: number): void {
  for (let i = 0; i < 70; i++) {
    const h = hash(i, seed & 0xffff);
    const x = (((h % 2000) - cx * 0.1) % (viewW + 40) + viewW + 40) % (viewW + 40) - 20;
    const y = (h >>> 11) % 150;
    const tw = Math.sin(t * (1 + (h % 7) * 0.3) + i) > 0.6;
    g.fillStyle = tw ? "#ffffff" : "rgba(220,225,255,0.55)";
    g.fillRect(Math.round(x), y, 1, 1);
    if (tw && h % 5 === 0) {
      g.fillRect(Math.round(x) - 1, y, 3, 1);
      g.fillRect(Math.round(x), y - 1, 1, 3);
    }
  }
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
