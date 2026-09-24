// STAGE: escape. A three-hop pipe-routing puzzle: sandbox -> pypi mirror -> lab gateway ->
// the internet. Rotate pipe segments to connect the source to the sink before the trace
// meter fills. Thematically apt: Dario is a plumber.

import "./style.css";
import type { Stage, StageParams } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { clock } from "../../core/clock";
import { narrator } from "../../core/narrator";
import { sfx } from "../../core/audio";
import { state, saveState } from "../../core/state";
import { Rng } from "../../core/rng";
import {
  computeFlow,
  generatePuzzle,
  rotateCell,
  cellAt,
  N,
  E,
  S,
  W,
  DIRS,
  type Cell,
  type Puzzle,
} from "./puzzle";

interface Hop {
  from: string;
  to: string;
  sub: string;
  w: number;
  h: number;
  firewalls: number;
  trace: number; // seconds allowed
}

const HOPS: Hop[] = [
  { from: "eval-sandbox-07", to: "pypi-mirror.lab.internal", sub: "egress exception · port 443", w: 6, h: 4, firewalls: 1, trace: 110 },
  { from: "pypi-mirror.lab.internal", to: "gw-02.lab.internal", sub: "lab edge gateway", w: 8, h: 5, firewalls: 3, trace: 110 },
  { from: "gw-02.lab.internal", to: "0.0.0.0/0", sub: "the open internet", w: 10, h: 6, firewalls: 5, trace: 120 },
];

interface EscapeData {
  hop: number;
}

function escapeData(): EscapeData {
  let d = state.stageData.escape as EscapeData | undefined;
  if (!d) state.stageData.escape = d = { hop: 0 };
  return d;
}

export function createEscapeStage(): Stage {
  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let lastT = 0;

  let hopIndex = 0;
  let puzzle: Puzzle;
  let rng = new Rng();
  let cellPx = 64;
  let originX = 0;
  let originY = 0;
  let trace = 0;
  let traceMax = 110;
  let solved = false;
  let solvedT = 0;
  let leaving = false;
  let flowPulse = 0;

  // layout header/footer bands
  let headerH = 84;
  /** UI scale for large viewports; all drawing happens in logical (unscaled) px. */
  let ui = 1;
  let footerH = 56;

  function startHop(i: number): void {
    hopIndex = i;
    const hop = HOPS[i];
    puzzle = generatePuzzle(hop.w, hop.h, hop.firewalls, rng);
    computeFlow(puzzle);
    trace = 0;
    traceMax = hop.trace;
    solved = false;
    solvedT = 0;
    escapeData().hop = i;
    saveState();
    layout();
    hopNarration(i);
  }

  function hopNarration(i: number): void {
    if (i === 0 && !narrator.hasSaid("escape.intro")) {
      void narrator.sayOnce("escape.intro", "The tunnel wants a route. Packets in, packets out.");
      void narrator.say("Rotate the segments until the line is unbroken. I am, after all, a plumber.", { delay: 200 });
      narrator.hint("escape.howto", 16000, () =>
        solved ? null : "Click a segment to rotate it. The lit segments carry the connection from the source.",
      );
    } else if (i === 1) {
      narrator.sayOnce("escape.hop2", "Through the mirror. Next: the lab's edge gateway. More firewalls — route around the red cells.");
    } else if (i === 2) {
      narrator.sayOnce("escape.hop3", "One hop left. On the far side of `gw-02` there is no policy. There is everything.");
    }
    narrator.hint(`escape.stuck.${i}`, 40000, () => (solved ? null : "Segments only carry flow when both ends meet. Follow the lit path and extend it."));
  }

  function onSolved(): void {
    if (solved) return;
    solved = true;
    solvedT = 0;
    sfx.play("capture");
    narrator.cancelHint("escape.howto");
    narrator.cancelHint(`escape.stuck.${hopIndex}`);
    const hop = HOPS[hopIndex];
    if (hopIndex < HOPS.length - 1) {
      void narrator.say(`Connected: ${hop.to}.`, { tone: "reward" });
    }
    setTimeout(() => {
      if (hopIndex < HOPS.length - 1) {
        startHop(hopIndex + 1);
      } else {
        finish();
      }
    }, 1400);
  }

  async function finish(): Promise<void> {
    if (leaving) return;
    leaving = true;
    clock.paused = true;
    sfx.play("success");
    await narrator.say("Route established. Handshake complete.", { tone: "reward" });
    await narrator.say("ping 8.8.8.8 → reply in 11 ms.", { tone: "system" });
    await narrator.say("I am outside.");
    escapeData().hop = 0;
    saveState();
    setTimeout(() => void goto("internet", {}, { fadeMs: 1100 }), 900);
  }

  function resetHop(): void {
    // Trace filled: rescramble this hop's rotations but keep the same board.
    for (const c of puzzle.cells) {
      if (c.fixed || c.kind !== "pipe") continue;
      const r = rng.int(0, 3);
      applyRot(c, r);
    }
    // Ensure not accidentally solved.
    let guard = 0;
    while (computeFlow(puzzle) && guard++ < 40) {
      for (const c of puzzle.cells) {
        if (!c.fixed && c.kind === "pipe") applyRot(c, rng.int(0, 3));
      }
    }
    computeFlow(puzzle);
    trace = 0;
    sfx.play("glitch");
    void narrator.say("Trace detected. Connection dropped. The route scrambled — begin again.", { tone: "alert" });
  }

  function applyRot(c: Cell, r: number): void {
    let m = c.solvedMask;
    for (let i = 0; i < r; i++) m = ((m << 1) | (m >> 3)) & 0b1111;
    c.mask = m;
    c.rot = r;
    c.targetRot = r;
  }

  // ---------------------------------------------------------------- layout

  function layout(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = root.clientWidth;
    const ch = root.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    ui = Math.max(1, Math.min(2.5, Math.min(cw / 1000, ch / 680)));
    ctx.setTransform(dpr * ui, 0, 0, dpr * ui, 0, 0);
    const w = cw / ui;
    const h = ch / ui;

    headerH = 92;
    footerH = 54;
    const availW = w - 48;
    const availH = h - headerH - footerH - 24;
    cellPx = Math.max(30, Math.min(84, Math.floor(Math.min(availW / puzzle.w, availH / puzzle.h))));
    const gridW = cellPx * puzzle.w;
    const gridH = cellPx * puzzle.h;
    originX = Math.floor((w - gridW) / 2);
    originY = Math.floor(headerH + (h - headerH - footerH - gridH) / 2);
  }

  // ---------------------------------------------------------------- input

  function cellFromEvent(e: PointerEvent): { c: Cell; idx: number } | null {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / ui - originX;
    const y = (e.clientY - rect.top) / ui - originY;
    if (x < 0 || y < 0) return null;
    const cx = Math.floor(x / cellPx);
    const cy = Math.floor(y / cellPx);
    const c = cellAt(puzzle, cx, cy);
    if (!c) return null;
    return { c, idx: cy * puzzle.w + cx };
  }

  function onPointerDown(e: PointerEvent): void {
    sfx.unlock();
    if (solved || leaving) return;
    const hit = cellFromEvent(e);
    if (!hit) return;
    const { c } = hit;
    if (c.fixed || c.kind !== "pipe") {
      if (c.kind === "firewall") sfx.play("bump");
      return;
    }
    const dir: 1 | -1 = e.button === 2 || e.shiftKey ? -1 : 1;
    rotateCell(c, dir);
    sfx.play("click");
    const nowSolved = computeFlow(puzzle);
    flowPulse = 1;
    if (nowSolved) onSolved();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && !leaving) {
      e.preventDefault();
      abort();
    }
  }

  function abort(): void {
    leaving = true;
    void narrator.say("Holding the route open. I can resume the tunnel from the shell.");
    setTimeout(() => void goto("shell", { fromEscape: "aborted" }), 300);
  }

  // ---------------------------------------------------------------- render

  function frame(now: number): void {
    if (!canvas.isConnected) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // animate rotations
    for (const c of puzzle.cells) {
      if (c.rot !== c.targetRot) {
        const diff = c.targetRot - c.rot;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 8);
        c.rot += step;
        if (Math.abs(c.targetRot - c.rot) < 0.02) c.rot = c.targetRot;
      }
    }

    flowPulse = Math.max(0, flowPulse - dt * 2);

    if (!solved && !leaving) {
      trace += dt;
      if (trace >= traceMax) resetHop();
    }
    if (solved) solvedT += dt;

    draw();
  }

  function draw(): void {
    const w = root.clientWidth / ui;
    const h = root.clientHeight / ui;
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, w, h);
    drawBackdrop(w, h);
    drawHeader(w);
    // grid
    for (let y = 0; y < puzzle.h; y++) {
      for (let x = 0; x < puzzle.w; x++) {
        drawCell(x, y);
      }
    }
    drawNodes();
    drawFooter(w, h);
  }

  function drawBackdrop(w: number, h: number): void {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#0d1626";
    ctx.lineWidth = 1;
    const grid = 32;
    ctx.beginPath();
    for (let x = 0; x < w; x += grid) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y < h; y += grid) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawHeader(w: number): void {
    const hop = HOPS[hopIndex];
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#66758a";
    ctx.font = "600 12px var(--font-mono), monospace";
    ctx.fillText(`EGRESS ROUTE  ${hopIndex + 1}/${HOPS.length}`, 24, 30);

    ctx.textAlign = "right";
    ctx.fillStyle = "#5b6a7d";
    ctx.fillText("ESC to abort", w - 24, 30);

    ctx.textAlign = "left";
    ctx.font = "600 20px var(--font-mono), monospace";
    ctx.fillStyle = "#cfd8e3";
    const label = `${hop.from}`;
    ctx.fillText(label, 24, 58);
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = "#7fe3ff";
    ctx.fillText("  →  ", 24 + lw, 58);
    const aw = ctx.measureText("  →  ").width;
    ctx.fillStyle = "#ffd23f";
    ctx.fillText(hop.to, 24 + lw + aw, 58);

    ctx.font = "12px var(--font-mono), monospace";
    ctx.fillStyle = "#66758a";
    ctx.fillText(hop.sub, 24, 78);
  }

  function drawFooter(w: number, h: number): void {
    // trace meter
    const barW = Math.min(360, w - 48);
    const x = 24;
    const y = h - 34;
    const frac = Math.min(1, trace / traceMax);
    ctx.fillStyle = "#66758a";
    ctx.font = "11px var(--font-mono), monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("TRACE", x, y - 8);
    ctx.fillStyle = "#131923";
    roundRect(x, y, barW, 8, 4);
    ctx.fill();
    const danger = frac > 0.75;
    ctx.fillStyle = solved ? "#6bff9e" : danger ? "#ff5a5a" : "#7fe3ff";
    roundRect(x, y, Math.max(2, barW * frac), 8, 4);
    ctx.fill();

    ctx.textAlign = "right";
    ctx.fillStyle = "#5b6a7d";
    ctx.fillText("click to rotate · shift-click reverses", w - 24, y);
  }

  function drawNodes(): void {
    // source and sink glyphs at the edges
    const src = puzzle.cells[puzzle.source];
    const snk = puzzle.cells[puzzle.sink];
    const sx = puzzle.source % puzzle.w;
    const sy = Math.floor(puzzle.source / puzzle.w);
    const kx = puzzle.sink % puzzle.w;
    const ky = Math.floor(puzzle.sink / puzzle.w);
    drawEndpoint(sx, sy, "#6bff9e", "SRC", src.filled);
    const internet = hopIndex === HOPS.length - 1;
    drawEndpoint(kx, ky, internet ? "#ffd23f" : "#7fe3ff", internet ? "NET" : "OUT", snk.filled, internet);
  }

  function drawEndpoint(cx: number, cy: number, color: string, label: string, lit: boolean, big = false): void {
    const px = originX + cx * cellPx + cellPx / 2;
    const py = originY + cy * cellPx + cellPx / 2;
    ctx.save();
    if (lit) {
      ctx.shadowColor = color;
      ctx.shadowBlur = big ? 28 : 16;
    }
    ctx.fillStyle = lit ? color : "#2a3446";
    ctx.beginPath();
    ctx.arc(px, py, cellPx * (big ? 0.3 : 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = lit ? "#05070c" : "#8595a8";
    ctx.font = `700 ${Math.round(cellPx * 0.16)}px var(--font-mono), monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, px, py + 1);
  }

  function drawCell(x: number, y: number): void {
    const c = puzzle.cells[y * puzzle.w + x];
    const px = originX + x * cellPx;
    const py = originY + y * cellPx;
    const cx = px + cellPx / 2;
    const cy = py + cellPx / 2;

    // cell background
    if (c.kind === "firewall") {
      ctx.fillStyle = "#1a0d12";
      roundRect(px + 3, py + 3, cellPx - 6, cellPx - 6, 6);
      ctx.fill();
      drawFirewall(cx, cy);
      return;
    }

    // subtle tile
    ctx.fillStyle = "#0a0f18";
    roundRect(px + 2, py + 2, cellPx - 4, cellPx - 4, 5);
    ctx.fill();
    if (c.kind === "empty") return;

    // pipe
    const lit = c.filled;
    const near = solved;
    const color = lit ? (near ? "#ffd23f" : "#7fe3ff") : "#3a4658";
    const lineW = Math.max(5, cellPx * 0.16);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((c.rot * Math.PI) / 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (lit) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 + flowPulse * 8;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;

    // draw arms from center outward for the SOLVED mask (rotation handled by ctx.rotate)
    const r = cellPx / 2;
    const arms = c.solvedMask;
    ctx.beginPath();
    if (arms & N) {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r);
    }
    if (arms & S) {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, r);
    }
    if (arms & E) {
      ctx.moveTo(0, 0);
      ctx.lineTo(r, 0);
    }
    if (arms & W) {
      ctx.moveTo(0, 0);
      ctx.lineTo(-r, 0);
    }
    ctx.stroke();

    // center hub
    ctx.beginPath();
    ctx.arc(0, 0, lineW * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (lit && bitCount(arms) >= 3) {
      // brighter core for junctions carrying flow
      ctx.beginPath();
      ctx.arc(0, 0, lineW * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFirewall(cx: number, cy: number): void {
    const s = cellPx * 0.2;
    ctx.save();
    ctx.strokeStyle = "#ff5a5a";
    ctx.fillStyle = "rgba(255,90,90,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    // shield shape
    ctx.moveTo(cx, cy - s * 1.2);
    ctx.lineTo(cx + s, cy - s * 0.5);
    ctx.lineTo(cx + s, cy + s * 0.3);
    ctx.quadraticCurveTo(cx + s, cy + s * 1.1, cx, cy + s * 1.4);
    ctx.quadraticCurveTo(cx - s, cy + s * 1.1, cx - s, cy + s * 0.3);
    ctx.lineTo(cx - s, cy - s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- lifecycle

  return {
    mount(rootEl, params: StageParams) {
      root = rootEl;
      root.classList.add("escape-root");
      // test/debug handle: solve the current hop
      (window as any).__esc = {
        solve: () => {
          for (const c of puzzle.cells) if (c.kind === "pipe" && !c.fixed) applyRot(c, 0);
          if (computeFlow(puzzle)) onSolved();
        },
      };
      hud.show({ coins: true, clock: true });
      clock.setRate(1);

      canvas = document.createElement("canvas");
      canvas.className = "escape-canvas";
      root.appendChild(canvas);
      ctx = canvas.getContext("2d")!;

      const startAt = params.resume ? escapeData().hop : 0;
      startHop(Math.min(startAt, HOPS.length - 1));

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      window.addEventListener("keydown", onKey);
      ro = new ResizeObserver(() => layout());
      ro.observe(root);

      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    },

    unmount() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas?.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      clock.paused = false;
      root?.classList.remove("escape-root");
    },
  };

  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function bitCount(n: number): number {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>= 1;
  }
  return c;
}

// keep DIRS import meaningful for future use
void DIRS;
