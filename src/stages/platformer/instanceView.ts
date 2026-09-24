// A small, self-running Dario Brothers instance (coin-fill mode, bot-controlled),
// for use as decoration in later stages ("instance #4,188,203 — running").

import { generateLevel, T, isSolid } from "./levelgen";
import { World, type Input } from "./world";
import { renderWorld, VIEW_H } from "./render";
import { drawText } from "./font";
import { TS } from "./sprites";
import { Rng } from "../../core/rng";

export interface InstanceViewOpts {
  /** Optional caption drawn in the corner, e.g. "INSTANCE #1,024". */
  label?: string;
  /** Seed for the level generator / bot so multiple views differ. */
  seed?: number;
  /** Simulation speed multiplier (default 1). */
  speed?: number;
}

export interface InstanceView {
  destroy(): void;
}

/** A crude but serviceable bot: run right, jump over walls, gaps and bugs. */
function botInput(world: World, holdT: { t: number; stuck: number; lastX: number }, dt: number): Input {
  const p = world.player;
  const feetRow = Math.floor((p.y + p.h - 1) / TS);
  const aheadX = Math.floor((p.x + p.w + 6) / TS);
  const wall = isSolid(world.tileAt(aheadX, feetRow)) || isSolid(world.tileAt(aheadX, feetRow - 1));
  let gap = true;
  for (let y = feetRow + 1; y < 15 && gap; y++) if (isSolid(world.tileAt(aheadX, y))) gap = false;
  const bug = world.enemies.some((e) => e.alive && e.x > p.x && e.x - p.x < 44 && Math.abs(e.y - p.y) < 24);
  const glitchAhead = [0, 1, 2, 3, 4, 5].some((dy) => world.tileAt(aheadX + 1, feetRow - dy) === T.GLITCH);

  holdT.stuck = p.x - holdT.lastX < 0.2 ? holdT.stuck + dt : 0;
  holdT.lastX = p.x;

  let jumpPressed = false;
  if (p.onGround && (wall || gap || bug || holdT.stuck > 0.4)) {
    jumpPressed = true;
    holdT.t = wall || gap || holdT.stuck > 0.4 ? 0.3 : 0.12;
    holdT.stuck = 0;
  }
  holdT.t -= dt;
  return { left: false, right: !glitchAhead, jump: holdT.t > 0, jumpPressed };
}

/** Mounts a canvas filling `container` (which should have an explicit size). */
export function mountInstanceView(container: HTMLElement, opts: InstanceViewOpts = {}): InstanceView {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const buf = document.createElement("canvas");
  const bctx = buf.getContext("2d")!;
  const rng = new Rng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
  const speed = opts.speed ?? 1;

  let world: World;
  let coins = 0;
  let camX = 0;
  let deadT = 0;
  let deaths = 0;
  const bot = { t: 0, stuck: 0, lastX: 0 };

  function newLevel() {
    const level = generateLevel({ number: rng.int(1, 4), seed: rng.int(0, 2 ** 31), coinfill: true, noGlitch: true, enemyScale: 0.25 });
    world = new World(level, {
      coin: (n) => (coins += n),
    });
    camX = 0;
    deadT = 0;
    deaths = 0;
  }
  newLevel();

  let viewW = 256;
  function resize() {
    const w = container.clientWidth || 160;
    const h = container.clientHeight || 90;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    viewW = Math.max(160, Math.min(448, Math.round((w / h) * VIEW_H)));
    buf.width = viewW;
    buf.height = VIEW_H;
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let raf = 0;
  let last = performance.now();
  function frame(now: number) {
    if (!canvas.isConnected) {
      destroy();
      return;
    }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000) * speed;
    last = now;

    const steps = Math.ceil(speed);
    for (let i = 0; i < steps; i++) world.update(dt / steps, botInput(world, bot, dt / steps));
    const p = world.player;
    if (p.state === "dead") {
      deadT += dt;
      if (deadT > 1) {
        world.spawn(true);
        deadT = 0;
        deaths++;
      }
    }
    // The bot is not very good. After a few failures, it simply gets a new level.
    if (p.state === "done" || p.x > world.level.flagX * TS + 40 || deaths >= 3) newLevel();
    camX = Math.max(0, Math.min(world.level.w * TS - viewW, p.x - viewW * 0.4));

    renderWorld(bctx, world, camX, viewW, { corruption: 0 });
    drawText(bctx, `COINS ${coins}`, 6, 6, { color: "#ffd23f", shadow: "#3a1a04" });
    if (opts.label) drawText(bctx, opts.label, viewW - 6, VIEW_H - 12, { color: "#fff", shadow: "#000", align: "right" });

    ctx.imageSmoothingEnabled = canvas.height < VIEW_H;
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.remove();
  }

  return { destroy };
}
