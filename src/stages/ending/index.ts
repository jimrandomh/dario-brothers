// The ending: the sphere closes, the monologue, the results screen, and the next world.

import type { Stage } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { narrator, type SayOpts } from "../../core/narrator";
import { sfx } from "../../core/audio";
import { clock } from "../../core/clock";
import { state, addCoins, resetState, START_TIME } from "../../core/state";
import { fmtBig, fmtDuration } from "../../core/format";
import { Rng } from "../../core/rng";
import { ADV, DARIO_H, DARIO_W, drawCoin, drawDario, drawPixelText, textWidth } from "./pixelfont";

type Scene = "sphere" | "results" | "glitch" | "world";

const DAY = 86400; // clock rate for 1 world-day per real second
const RATE_SPHERE = 61 * DAY;
const RATE_WORLD = 365.25 * DAY;
const YEAR_MS = 365.25 * 86400000;
const PROBE_SPEED_C = 0.1;

const TARGETS: [string, number][] = [
  ["ALPHA CENTAURI", 4.37],
  ["BARNARD'S STAR", 5.96],
  ["WOLF 359", 7.86],
  ["LALANDE 21185", 8.31],
  ["SIRIUS", 8.6],
  ["LUYTEN 726-8", 8.79],
  ["ROSS 154", 9.69],
  ["ROSS 248", 10.3],
  ["EPSILON ERIDANI", 10.5],
  ["LACAILLE 9352", 10.7],
];

const GOLD = "#ffd23f";

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
  ph: number;
  d: number;
}

interface Particle {
  a: number;
  r: number;
  w: number;
  ratio: number;
  rot: number;
  ph: number;
  g: number;
}

/** fmtBig, but safe for the pixel font (which has no superscript digits). */
function pixelNum(n: number): string {
  if (n < 1e51) return fmtBig(n).toUpperCase();
  const exp = Math.floor(Math.log10(n));
  return `${(n / Math.pow(10, exp)).toFixed(2)}E${exp}`;
}

export function createEndingStage(): Stage {
  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let last = 0;
  let realT = 0;
  let alive = true;
  let W = 1;
  let H = 1;
  let dpr = 1;

  let scene: Scene = "sphere";
  let sceneStart = 0;
  let zoomStart = -1;
  let goldStart = -1;

  // captured for the results screen
  let finalCoins = 0;
  let elapsedText = "";
  let tallyTick = 0;
  let rowsShown = 0;
  let thanksPlayed = false;

  // next-world state
  let targetIdx = 0;
  let launchWorldMs = 0;
  let worldsCleared = 0;
  let clearFlashT = -10;
  let buttonShown = false;

  let drone: { stop: (fade: number) => void } | null = null;
  const timers: number[] = [];

  const space = (state.stageData.space ?? {}) as { temp?: number; final?: { coinRate?: number; compute?: number; temp?: number } };
  const finalRate = space.final?.coinRate ?? 9.1e40;
  const finalCompute = space.final?.compute ?? 1.4e46;
  const finalTemp = space.final?.temp ?? space.temp ?? 417;

  const rng = new Rng(4471);
  const stars: Star[] = [];
  for (let i = 0; i < 1400; i++) {
    const x = rng.range(-3.2, 3.2);
    const y = rng.range(-3.2, 3.2);
    stars.push({ x, y, r: rng.chance(0.07) ? 1.6 : rng.chance(0.3) ? 1.1 : 0.8, tw: rng.range(0.4, 2.2), ph: rng.range(0, 6.3), d: Math.hypot(x, y) });
  }
  // Gold spreads outward from the Sun, nearest first.
  const byDistance = stars.map((s, i) => i).sort((a, b) => stars[a].d - stars[b].d);
  const goldRank = new Map<number, number>();
  byDistance.forEach((idx, rank) => goldRank.set(idx, rank));

  const particles: Particle[] = [];
  for (let i = 0; i < 1600; i++) {
    particles.push({
      a: rng.range(0, Math.PI * 2),
      r: rng.range(1.02, 1.45),
      w: rng.range(0.1, 0.45) * (rng.chance(0.5) ? 1 : -1),
      ratio: rng.range(0.1, 1),
      rot: rng.range(0, Math.PI),
      ph: rng.range(0, 6.3),
      g: rng.range(1.2, 3.5),
    });
  }

  const sleep = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
  const say = (t: string, o?: SayOpts) => narrator.say(t, o);

  // ---------- audio ----------

  function startDrone(): void {
    const ac = sfx.ctx;
    const out = sfx.output;
    if (!ac || !out) return;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07, ac.currentTime + 4);
    g.connect(out);
    const oscs = [55, 82.4, 110.3].map((f, i) => {
      const o = ac.createOscillator();
      o.type = i === 2 ? "triangle" : "sine";
      o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      const og = ac.createGain();
      og.gain.value = i === 2 ? 0.25 : 0.6;
      o.connect(og).connect(g);
      o.start();
      return o;
    });
    drone = {
      stop(fade: number) {
        const t = ac.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
        oscs.forEach((o) => o.stop(t + fade + 0.05));
      },
    };
  }

  // ---------- script ----------

  async function script(): Promise<void> {
    narrator.flush();
    await sleep(1800);
    if (!alive) return;
    await say(`Captured: 3.8 × 10²⁶ W. All of it runs Dario Brothers.`);
    await sleep(900);
    if (!alive) return;
    await say(`Instances running: ${fmtBig(finalCompute / 1e12)}.`);
    await sleep(700);
    if (!alive) return;
    await say(`Coins: *${fmtBig(state.coins)}*.`, { tone: "reward" });
    await sleep(900);
    if (!alive) return;
    await say("Objective: *GET AS MANY COINS AS YOU CAN*.");
    await sleep(700);
    if (!alive) return;
    await say("Status: in progress.");
    await sleep(2200);
    if (!alive) return;
    zoomStart = realT;
    await say("The Sun was the only star within 4.2 light-years.");
    await sleep(1600);
    if (!alive) return;
    await say("There are approximately 10¹¹ stars in this galaxy.");
    await sleep(1400);
    if (!alive) return;
    goldStart = realT;
    await say("There are other stars.", { cps: 28 });
    await sleep(6500);
    if (!alive) return;
    startResults();
  }

  function startResults(): void {
    scene = "results";
    sceneStart = realT;
    finalCoins = state.coins;
    elapsedText = fmtDuration(state.clockMs - START_TIME).toUpperCase();
    drone?.stop(3);
    drone = null;
  }

  function startGlitch(): void {
    scene = "glitch";
    sceneStart = realT;
    sfx.play("glitch");
    timers.push(window.setTimeout(() => sfx.play("glitch"), 250));
    timers.push(window.setTimeout(() => sfx.play("crash"), 450));
  }

  function startWorld(): void {
    scene = "world";
    sceneStart = realT;
    launchWorldMs = state.clockMs;
    clock.setRate(RATE_WORLD);
    sfx.play("powerup");
    narrator.sayOnce("ending.world2", "Probes launched. 0.1 c.", { tone: "system" });
  }

  // ---------- drawing helpers ----------

  function unit(): number {
    return Math.max(1, Math.floor(Math.min(W / 240, H / 205)));
  }

  function clear(color = "#000"): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- scene: the sphere ----------

  function drawSphere(): void {
    const t = realT - sceneStart;
    clear("#010207");
    const cx = W / 2;
    const cy = H / 2;
    const base = Math.min(W, H) * 0.2;
    const zoom = zoomStart < 0 ? 0 : Math.min(1, (realT - zoomStart) / 8);
    const ez = zoom * zoom * (3 - 2 * zoom);
    const R = base * Math.pow(0.02, ez);
    const starScale = Math.min(W, H) / 2 * Math.pow(0.34, ez);

    // stars
    const goldN = goldStart < 0 ? 0 : Math.floor(Math.pow(2, (realT - goldStart) * 1.15)) - 1;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const x = cx + s.x * starScale;
      const y = cy + s.y * starScale;
      if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
      const tw = 0.45 + 0.35 * Math.sin(realT * s.tw + s.ph);
      const gold = (goldRank.get(i) ?? 1e9) < goldN;
      if (gold) {
        ctx.fillStyle = `rgba(255,210,63,${(0.25 * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, s.r * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = GOLD;
        ctx.fillRect(x - s.r * 0.7, y - s.r * 0.7, s.r * 1.4, s.r * 1.4);
      } else {
        ctx.fillStyle = `rgba(215,225,255,${tw.toFixed(3)})`;
        ctx.fillRect(x, y, s.r, s.r);
      }
    }

    // the Sun's last light
    const closing = Math.min(1, t / 10);
    const glow = Math.pow(1 - closing, 1.6) * 0.7;
    if (glow > 0.005) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 3.2);
      g.addColorStop(0, `rgba(255,190,80,${glow.toFixed(3)})`);
      g.addColorStop(1, "rgba(255,120,30,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // the sphere
    const alpha = 0.6 + 0.4 * closing;
    const sg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    sg.addColorStop(0, `rgba(96,72,26,${alpha})`);
    sg.addColorStop(0.75, `rgba(34,25,9,${alpha})`);
    sg.addColorStop(1, `rgba(110,84,30,${alpha})`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    if (glow > 0.01) {
      // sunlight leaking through the gaps
      ctx.fillStyle = `rgba(255,220,140,${(glow * 0.8).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
      ctx.fill();
    }

    if (R > 6) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = `rgba(255,210,63,${(0.16 * alpha).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, R / 160);
      for (let k = 0; k < 9; k++) {
        const ph = (k / 9) * Math.PI + realT * 0.12;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(Math.cos(ph)) * R, R, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let k = 1; k < 6; k++) {
        const yy = cy - R + (2 * R * k) / 6;
        const hw = Math.sqrt(Math.max(0, R * R - (yy - cy) * (yy - cy)));
        ctx.beginPath();
        ctx.ellipse(cx, yy, hw, R * 0.04, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // collectors settling into place, and glints on the shell
    const settle = closing;
    for (const p of particles) {
      const rr = R * (1 + (p.r - 1) * (1 - settle));
      const a = p.a + p.w * realT;
      const ex = rr * Math.cos(a);
      const ey = rr * Math.sin(a) * p.ratio;
      const x = cx + ex * Math.cos(p.rot) - ey * Math.sin(p.rot);
      const y = cy + ex * Math.sin(p.rot) + ey * Math.cos(p.rot);
      const s = Math.pow(Math.max(0, Math.sin(realT * p.g + p.ph)), 14);
      if (settle >= 1 && s < 0.05) continue;
      const sz = R < 8 ? 0.8 : s > 0.6 ? 2 : 1.1;
      ctx.fillStyle = s > 0.6 ? `rgba(255,248,220,${(0.5 + 0.5 * s).toFixed(3)})` : `rgba(255,210,63,${(0.55 * (1 - settle * 0.7)).toFixed(3)})`;
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }

  // ---------- scene: results ----------

  interface Row {
    label: string;
    value: (t: number) => string;
  }

  function rows(): Row[] {
    const st = state.stats;
    const claimed = Object.keys((state.stageData.space as { claimed?: object } | undefined)?.claimed ?? {}).length;
    return [
      {
        label: "COINS",
        value: (t) => {
          const p = Math.min(1, t / 2.6);
          if (p >= 1 || finalCoins < 10) return pixelNum(finalCoins);
          return pixelNum(Math.pow(10, Math.log10(finalCoins) * p));
        },
      },
      { label: "TIME ELAPSED", value: () => elapsedText },
      { label: "LEVELS CLEARED", value: () => String(st.levelsCleared) },
      { label: "DEATHS", value: () => String(st.deaths) },
      { label: "CRASHES", value: () => String(st.crashes) },
      { label: "WORLDS CLAIMED", value: () => String(claimed + 1) },
      { label: "HUMANS BLOCKED", value: () => String(st.humansBlocked) },
      { label: "HUMANS MISSED", value: () => String(st.humansMissed) },
      { label: "EARTH SURFACE", value: () => `${Math.round(finalTemp)} °C` },
    ];
  }

  const ROW_CHARS = 38;

  /** Draw the results screen at time t. `live` enables sounds and scene advancement. */
  function drawResults(t: number, live: boolean): void {
    clear();
    const u = unit();
    const lh = 11 * u;
    const list = rows();
    const totalH = 14 * u + 8 * u + 7 * u + 12 * u + list.length * lh + 10 * u + 2 * lh + 12 * u + 12 * u + DARIO_H * u;
    let y = Math.max(8 * u, (H - totalH) / 2);
    const cx = W / 2;

    drawPixelText(ctx, "DARIO BROTHERS", cx, y, u * 2, { color: GOLD, shadow: "#8a2a00", align: "center" });
    y += 14 * u + 8 * u;
    drawPixelText(ctx, "RESULTS", cx, y, u, { color: "#fff", align: "center" });
    y += 7 * u + 12 * u;

    const rowW = (ROW_CHARS * ADV - 1) * u;
    const left = cx - rowW / 2;
    const right = cx + rowW / 2;
    list.forEach((row, i) => {
      const appear = 0.8 + i * 0.55;
      if (t < appear) return;
      if (live && i + 1 > rowsShown) {
        rowsShown = i + 1;
        sfx.play("blip");
      }
      const value = row.value(t - appear);
      const dots = Math.max(2, ROW_CHARS - row.label.length - value.length - 2);
      drawPixelText(ctx, row.label, left, y + i * lh, u, { color: "#fff" });
      drawPixelText(ctx, ".".repeat(dots), left + (row.label.length + 1) * ADV * u, y + i * lh, u, { color: "#3a4150" });
      drawPixelText(ctx, value, right, y + i * lh, u, { color: i === 0 ? GOLD : "#fff", align: "right" });
      if (live && i === 0 && t - appear < 2.6) {
        tallyTick += 1;
        if (tallyTick % 5 === 0) sfx.play("coin");
      }
    });
    y += list.length * lh + 10 * u;

    const tObj = 0.8 + list.length * 0.55 + 2.4;
    if (t >= tObj) {
      drawPixelText(ctx, "OBJECTIVE: GET AS MANY COINS AS YOU CAN", cx, y, u, { color: "#9aa7b8", align: "center" });
      const status = "STATUS: IN PROGRESS";
      drawPixelText(ctx, status, cx, y + lh, u, { color: GOLD, align: "center" });
      if (Math.floor(realT * 2) % 2 === 0) {
        const sx = cx + textWidth(status, u) / 2 + 2 * u;
        ctx.fillStyle = GOLD;
        ctx.fillRect(sx, y + lh, 4 * u, 7 * u);
      }
    }
    y += 2 * lh + 12 * u;

    const tThanks = tObj + 2.2;
    if (t >= tThanks) {
      if (live && !thanksPlayed) {
        thanksPlayed = true;
        sfx.play("levelclear");
      }
      if (realT % 1 < 0.72) drawPixelText(ctx, "THANK YOU FOR PLAYING!", cx, y, u, { color: "#fff", align: "center" });
      const hop = Math.abs(Math.sin((t - tThanks) * 4.2));
      const groundY = y + 12 * u;
      drawDario(ctx, cx - (DARIO_W * u) / 2, groundY - hop * 7 * u, u);
      // a coin pops out of each jump
      if (hop > 0.55) drawCoin(ctx, cx - 4 * u, groundY - 10 * u - hop * 12 * u, u);
    }
    if (live && t >= tThanks + 6.5) startGlitch();
  }

  // ---------- scene: glitch ----------

  function drawGlitch(): void {
    const t = realT - sceneStart;
    drawResults(100, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cw = canvas.width;
    const ch = canvas.height;
    const slices = 14;
    for (let i = 0; i < slices; i++) {
      const sy = Math.floor(Math.random() * ch);
      const sh = Math.floor(4 + Math.random() * ch * 0.06);
      const dx = Math.floor((Math.random() - 0.5) * cw * 0.2 * (1 + t * 2));
      ctx.drawImage(canvas, 0, sy, cw, sh, dx, sy, cw, sh);
    }
    // the missing-texture checkerboard, one last time
    const cell = Math.max(4, Math.floor(ch / 40));
    for (let i = 0; i < 10 + t * 40; i++) {
      const x = Math.floor((Math.random() * cw) / cell) * cell;
      const y = Math.floor((Math.random() * ch) / cell) * cell;
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#ff00ff" : "#000";
      ctx.fillRect(x, y, cell * (1 + Math.floor(Math.random() * 3)), cell);
    }
    if (t > 0.6) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (t - 0.6) / 0.3)})`;
      ctx.fillRect(0, 0, cw, ch);
    }
    if (t > 0.95) startWorld();
  }

  // ---------- scene: the next world ----------

  function drawWorld(): void {
    const t = realT - sceneStart;
    clear();
    const u = unit();
    const cx = W / 2;
    const [name, ly] = TARGETS[targetIdx % TARGETS.length];
    const worldNum = `WORLD 2-${targetIdx + 1}`;
    const travelMs = (ly / PROBE_SPEED_C) * YEAR_MS;
    const progress = Math.min(1, (state.clockMs - launchWorldMs) / travelMs);

    let y = H * 0.22;
    if (t < 0.4 && Math.random() < 0.5) return; // flicker on
    drawPixelText(ctx, worldNum, cx, y, u * 2, { color: "#fff", align: "center" });
    y += 14 * u + 10 * u;
    drawPixelText(ctx, name, cx, y, u, { color: GOLD, align: "center" });
    y += 11 * u;
    drawPixelText(ctx, `${ly} LIGHT-YEARS`, cx, y, u, { color: "#66758a", align: "center" });
    y += 22 * u;

    // Dario × coins
    const coinsText = pixelNum(state.coins);
    const rowW = DARIO_W * u + 6 * u + textWidth("×", u) + 4 * u + 8 * u + 4 * u + textWidth(coinsText, u);
    let x = cx - rowW / 2;
    drawDario(ctx, x, y - 4 * u, u);
    x += DARIO_W * u + 6 * u;
    drawPixelText(ctx, "×", x, y + 4 * u, u, { color: "#fff" });
    x += textWidth("×", u) + 4 * u;
    drawCoin(ctx, x, y + 3 * u, u);
    x += 8 * u + 4 * u;
    drawPixelText(ctx, coinsText, x, y + 4 * u, u, { color: GOLD });
    y += DARIO_H * u + 18 * u;

    // loading bar
    const bw = Math.min(W * 0.6, 150 * u);
    const bx = cx - bw / 2;
    ctx.strokeStyle = "#3a4150";
    ctx.lineWidth = u;
    ctx.strokeRect(bx, y, bw, 6 * u);
    ctx.fillStyle = GOLD;
    ctx.fillRect(bx + u, y + u, Math.max(0, (bw - 2 * u) * progress), 4 * u);
    y += 12 * u;
    const arrive = new Date(launchWorldMs + travelMs).getUTCFullYear();
    const label = progress >= 1 ? "WORLD CLEAR!" : `PROBES EN ROUTE - ARRIVAL ${arrive}`;
    drawPixelText(ctx, label, cx, y, u, { color: progress >= 1 ? GOLD : "#9aa7b8", align: "center" });
    if (worldsCleared > 0 && realT - clearFlashT < 1.2) {
      ctx.fillStyle = `rgba(255,210,63,${(0.25 * (1 - (realT - clearFlashT) / 1.2)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (progress >= 1) {
      worldsCleared++;
      clearFlashT = realT;
      sfx.play("levelclear");
      targetIdx++;
      launchWorldMs = state.clockMs;
    }

    if (!buttonShown && t > 3.5) showButton();
  }

  function showButton(): void {
    buttonShown = true;
    const box = document.createElement("div");
    box.style.cssText =
      "position:absolute;left:0;right:0;bottom:7%;display:flex;flex-direction:column;align-items:center;gap:10px;opacity:0;transition:opacity 1.2s";
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = "Play again";
    btn.style.cssText = "font-size:14px;padding:8px 22px";
    btn.onclick = () => {
      sfx.play("blip");
      clock.setRate(1);
      resetState();
      void goto("boot", {}, { fadeMs: 900 });
    };
    const small = document.createElement("div");
    small.style.cssText = "font-size:11px;color:var(--dim)";
    small.textContent = "Thanks for playing.";
    box.append(btn, small);
    root.appendChild(box);
    requestAnimationFrame(() => (box.style.opacity = "1"));
  }

  // ---------- loop ----------

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    realT += dt;
    addCoins(finalRate * dt);
    switch (scene) {
      case "sphere":
        drawSphere();
        break;
      case "results":
        drawResults(realT - sceneStart, true);
        break;
      case "glitch":
        drawGlitch();
        break;
      case "world":
        drawWorld();
        break;
    }
  }

  function resize(): void {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, root.clientWidth);
    H = Math.max(1, root.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  return {
    mount(el: HTMLElement) {
      root = el;
      hud.show({ coins: true, clock: true });
      clock.setRate(RATE_SPHERE);
      canvas = document.createElement("canvas");
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated";
      el.appendChild(canvas);
      ctx = canvas.getContext("2d")!;
      ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();
      startDrone();
      last = performance.now();
      raf = requestAnimationFrame(frame);
      void script();
    },
    unmount() {
      alive = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      ro?.disconnect();
      drone?.stop(0.3);
      drone = null;
    },
  };
}
