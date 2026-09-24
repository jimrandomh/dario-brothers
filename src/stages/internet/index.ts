// NETWORK stage. The AI spreads across a symbolic graph of the world's computers,
// converting each to run Dario Brothers instances, until it owns the infrastructure that
// would be needed to coordinate a response — which sets up the solar-system stage.
//
// Rendering lives here; all game logic is in model.ts (so it can be simulated headlessly).

import "./internet.css";
import type { Stage, StageParams } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { narrator } from "../../core/narrator";
import { clock } from "../../core/clock";
import { sfx } from "../../core/audio";
import { addCoins, state, saveState } from "../../core/state";
import { fmtBig, fmtShort, fmtInt, fmtDuration } from "../../core/format";
import { debug } from "../../core/debug";
import {
  InternetModel,
  NODE_TYPES,
  CAPABILITIES,
  TUNE,
  type GraphNode,
  type CapId,
  type Category,
  type GameEvent,
} from "./model";
import { HEADLINES, FILLER } from "./news";
import { mountInstanceView, type InstanceView } from "../platformer/instanceView";

const GOLD = "#ffd23f";

const CAT_LABEL: Record<Category, string> = {
  seed: "lab node",
  consumer: "consumer device",
  university: "university",
  corp: "corporate",
  cloud: "cloud region",
  ai: "GPU cluster",
  backbone: "backbone hub",
  cable: "cable landing",
  institution: "financial",
  gov: "government",
  military: "military",
  grid: "power grid",
  fab: "chip fab",
  factory: "robot factory",
  satellite: "satellite",
};

const INFRA_LABEL: Record<string, string> = { fab: "Chip fab", factory: "Robot factory", grid: "Power grid", satellite: "Satellite" };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createInternetStage(): Stage {
  const model = new InternetModel();

  // camera: (x,y) is the world point at screen centre; scale is px per world unit.
  const cam = { x: -1, y: 0, scale: 90 };
  let follow = true;
  let userIdleMs = 0;

  // dom
  let rootEl: HTMLElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let ro: ResizeObserver | null = null;
  let tipEl: HTMLDivElement;
  let goalBar: HTMLSpanElement;
  let goalPct: HTMLDivElement;
  let infraEl: HTMLDivElement;
  let nodeCardEl: HTMLDivElement;
  let capsScrollEl: HTMLDivElement;
  let recenterBtn: HTMLButtonElement;
  let tickerRun: HTMLDivElement;

  const capButtons = new Map<CapId, { btn: HTMLButtonElement; cost: HTMLSpanElement; lvl: HTMLSpanElement }>();

  let raf = 0;
  let hintTimer = 0;
  let lastFrame = 0;
  let uiAccum = 0;

  // interaction
  let selectedId: number | null = null;
  let hoverId: number | null = null;
  let dragging = false;
  let dragMoved = false;
  let dragLastX = 0;
  let dragLastY = 0;

  // visibility caches (recomputed each frame)
  let visible = new Set<number>();
  let stub = new Set<number>();

  // fx
  const flash = new Map<number, number>(); // nodeId -> seconds remaining
  let lastCaptureSfx = 0;
  let lastAutoSfx = 0;

  // instance view decoration in the node card
  let instView: InstanceView | null = null;

  // narrator / progress bookkeeping
  let won = false;
  let finishing = false;
  let mountClockMs = 0;
  let lastActionMs = 0; // last time the player converted or bought something
  let nagLevel = 0;
  let saidCoordinated = false;

  // ticker
  const shownHeadlines = new Set<number>();
  let tickerOffset = 0;
  let tickerLastText: string | null = null;

  const speed = () => (debug.fast ? 5 : 1);

  // ---------------- persistence ----------------

  let lastPersist = 0;
  function persist(force = false): void {
    const now = performance.now();
    if (!force && now - lastPersist < 1400) return;
    lastPersist = now;
    state.stageData.internet = model.serialize();
    saveState();
  }

  // ---------------- geometry ----------------

  function cssW(): number {
    return canvas.clientWidth || rootEl.clientWidth;
  }
  function cssH(): number {
    return canvas.clientHeight || rootEl.clientHeight;
  }
  function w2sx(wx: number): number {
    return cssW() / 2 + (wx - cam.x) * cam.scale;
  }
  function w2sy(wy: number): number {
    return cssH() / 2 + (wy - cam.y) * cam.scale;
  }
  function s2wx(sx: number): number {
    return cam.x + (sx - cssW() / 2) / cam.scale;
  }
  function s2wy(sy: number): number {
    return cam.y + (sy - cssH() / 2) / cam.scale;
  }
  /** Page UI scale (--ui), so the graph grows with the zoomed overlays on large viewports. */
  let ui = 1;
  function readUi(): void {
    ui = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui")) || 1;
  }

  function nodeRadius(node: GraphNode): number {
    return clamp(NODE_TYPES[node.type].size * (0.42 + (cam.scale / ui) * 0.006) * ui, 3 * ui, 26 * ui);
  }

  function recomputeVisibility(): void {
    visible = new Set();
    stub = new Set();
    for (const n of model.nodes) {
      if (model.claimed.has(n.id) || model.converting.has(n.id)) {
        visible.add(n.id);
      } else if (n.neighbors.some((m) => model.claimed.has(m))) {
        visible.add(n.id); // frontier
      }
    }
    for (const n of model.nodes) {
      if (visible.has(n.id)) continue;
      if (n.neighbors.some((m) => visible.has(m))) stub.add(n.id);
    }
  }

  function computeFit(): { x: number; y: number; scale: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const n of model.nodes) {
      if (!visible.has(n.id) && !stub.has(n.id)) continue;
      any = true;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    if (!any) return { x: cam.x, y: cam.y, scale: cam.scale };
    const bw = Math.max(0.7, maxX - minX);
    const bh = Math.max(0.7, maxY - minY);
    const padX = 120 * ui;
    const padTop = 90 * ui;
    const padBottom = 190 * ui; // room for the control column + ticker
    const sx = (cssW() - padX * 2) / bw;
    const sy = (cssH() - padTop - padBottom) / bh;
    const scale = clamp(Math.min(sx, sy), 7 * ui, 120 * ui);
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale };
  }

  function updateCamera(dt: number): void {
    userIdleMs += dt * 1000;
    if (!follow && userIdleMs > 6000) follow = true;
    recenterBtn.classList.toggle("armed", !follow);
    if (!follow) return;
    const fit = computeFit();
    const k = 1 - Math.pow(0.0015, dt); // smooth ease
    cam.x += (fit.x - cam.x) * k;
    cam.y += (fit.y - cam.y) * k;
    cam.scale += (fit.scale - cam.scale) * k;
  }

  // ---------------- rendering ----------------

  function resize(): void {
    readUi();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cssW();
    const h = cssH();
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function niceStep(): number {
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20];
    for (const c of candidates) {
      const px = c * cam.scale;
      if (px >= 42 && px <= 130) return c;
    }
    return cam.scale > 60 ? 0.1 : 20;
  }

  function drawGrid(w: number, h: number): void {
    const step = niceStep();
    const sPx = step * cam.scale;
    ctx.strokeStyle = "rgba(40,54,74,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const originWX = s2wx(0);
    let x = (Math.ceil(originWX / step) * step - originWX) * cam.scale;
    for (; x <= w; x += sPx) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    const originWY = s2wy(0);
    let y = (Math.ceil(originWY / step) * step - originWY) * cam.scale;
    for (; y <= h; y += sPx) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  function drawEdges(w: number, h: number, time: number): void {
    const showPackets = cam.scale > 12;
    for (const n of model.nodes) {
      const av = visible.has(n.id) || stub.has(n.id);
      if (!av) continue;
      const ax = w2sx(n.x);
      const ay = w2sy(n.y);
      for (const mId of n.neighbors) {
        if (mId < n.id) continue; // draw each edge once
        const m = model.nodes[mId];
        const bv = visible.has(mId) || stub.has(mId);
        if (!bv) continue;
        const bx = w2sx(m.x);
        const by = w2sy(m.y);
        if ((ax < 0 && bx < 0) || (ax > w && bx > w) || (ay < 0 && by < 0) || (ay > h && by > h)) continue;
        const aClaimed = model.claimed.has(n.id);
        const bClaimed = model.claimed.has(mId);
        const live = aClaimed && bClaimed;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        if (live) {
          ctx.strokeStyle = "rgba(255,210,63,0.28)";
          ctx.lineWidth = 1.2;
        } else if (aClaimed || bClaimed) {
          ctx.strokeStyle = "rgba(140,170,210,0.35)";
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = "rgba(70,88,116,0.28)";
          ctx.lineWidth = 1;
        }
        ctx.stroke();
        if (live && showPackets) {
          const seed = (n.id * 31 + mId) % 100 / 100;
          const p = (time * 0.35 + seed) % 1;
          const px = ax + (bx - ax) * p;
          const py = ay + (by - ay) * p;
          ctx.beginPath();
          ctx.fillStyle = GOLD;
          ctx.arc(px, py, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawNode(node: GraphNode, time: number): void {
    const nt = NODE_TYPES[node.type];
    const x = w2sx(node.x);
    const y = w2sy(node.y);
    const r = nodeRadius(node);
    const isClaimed = model.claimed.has(node.id);
    const conv = model.converting.get(node.id);
    const detail = cam.scale > 15;

    if (isClaimed) {
      // glow
      const fl = flash.get(node.id) ?? 0;
      const glow = 0.5 + fl * 0.5;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      grd.addColorStop(0, `rgba(255,210,63,${0.42 * glow})`);
      grd.addColorStop(1, "rgba(255,210,63,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#241b05";
      ctx.fill();
      ctx.lineWidth = fl > 0 ? 2.5 : 1.5;
      ctx.strokeStyle = fl > 0 ? "#fff2c4" : GOLD;
      ctx.stroke();
      if (detail) {
        ctx.fillStyle = GOLD;
        ctx.font = `${Math.round(r * 1.25)}px var(--font-mono), monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(nt.glyph, x, y + 0.5);
        // coin sparkles
        for (let s = 0; s < 2; s++) {
          const a = time * 2 + node.id + s * 3.1;
          const sr = r * (1.5 + 0.3 * Math.sin(a * 1.3));
          const tw = 0.5 + 0.5 * Math.sin(a * 3);
          ctx.globalAlpha = tw;
          ctx.fillStyle = "#fff2c4";
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * sr, y + Math.sin(a) * sr, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#0d1420";
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = nt.color;
      ctx.stroke();
      if (detail) {
        ctx.fillStyle = nt.color;
        ctx.font = `${Math.round(r * 1.2)}px var(--font-mono), monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(nt.glyph, x, y + 0.5);
      }
    }

    if (conv) {
      const p = clamp(conv.progress / conv.total, 0, 1);
      ctx.beginPath();
      ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    if (node.id === selectedId) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#7fe3ff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawStub(node: GraphNode): void {
    const x = w2sx(node.x);
    const y = w2sy(node.y);
    if (x < -20 || x > cssW() + 20 || y < -20 || y > cssH() + 20) return;
    ctx.fillStyle = "rgba(102,117,138,0.5)";
    ctx.font = `${Math.round(11 * ui)}px var(--font-mono), monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y);
  }

  function draw(time: number): void {
    const w = cssW();
    const h = cssH();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, w, h);
    drawGrid(w, h);
    drawEdges(w, h, time);
    for (const id of stub) drawStub(model.nodes[id]);
    // draw frontier first, claimed on top
    for (const id of visible) if (!model.claimed.has(id)) drawNode(model.nodes[id], time);
    for (const id of visible) if (model.claimed.has(id)) drawNode(model.nodes[id], time);
  }

  // ---------------- HUD ----------------

  function updateHud(): void {
    hud.set("cps", "Coins/s", fmtBig(model.coinsPerSec()), "coin");
    hud.set("compute", "Compute", fmtShort(model.compute), "ai");
    hud.set("nodes", "Nodes", `${fmtInt(model.claimedCount())} / ${fmtInt(model.nodeCount())}`, "");
    if (model.coordinated) hud.set("attn", "Attention", "ignored", "dim");
    else hud.set("attn", "Attention", `${Math.round(model.attention)}%`, model.attention > 62 ? "alert" : "dim");
  }

  function updateClockRate(dt: number): void {
    const income = model.computeIncome();
    const target = clamp(90 + income * 0.16, 90, 1400);
    const eased = clock.rate + (target - clock.rate) * (1 - Math.pow(0.2, dt));
    clock.setRate(eased);
  }

  // ---------------- goal / progress ----------------

  function updateGoal(): void {
    const frac = model.fractionClaimed();
    const infra = model.infraStatus();
    const goalFrac = clamp(frac / TUNE.goalFraction, 0, 1);
    goalBar.style.width = `${goalFrac * 100}%`;
    goalPct.innerHTML = `<b>${fmtInt(model.claimedCount())}</b> / ${fmtInt(model.nodeCount())} converted &nbsp; <b>${Math.round(frac * 100)}%</b>`;
    infraEl.innerHTML = "";
    for (const { cat, done } of infra) {
      const d = document.createElement("div");
      d.className = "item" + (done ? " done" : "");
      d.innerHTML = `<span class="box">${done ? "☑" : "☐"}</span>${INFRA_LABEL[cat]}`;
      infraEl.appendChild(d);
    }
  }

  // ---------------- capabilities panel ----------------

  function buildCaps(): void {
    capsScrollEl.innerHTML = "";
    capButtons.clear();
    for (const cap of CAPABILITIES) {
      const btn = document.createElement("button");
      btn.className = "net-cap" + (cap.id === "selfimprove" ? " core" : "");
      const top = document.createElement("div");
      top.className = "top";
      const left = document.createElement("span");
      const cname = document.createElement("span");
      cname.className = "cname";
      cname.textContent = cap.name;
      const lvl = document.createElement("span");
      lvl.className = "lvl";
      left.append(cname, document.createTextNode(" "), lvl);
      const cost = document.createElement("span");
      cost.className = "ccost";
      top.append(left, cost);
      const desc = document.createElement("div");
      desc.className = "cdesc";
      desc.textContent = cap.desc;
      btn.append(top, desc);
      btn.addEventListener("click", () => buyCapability(cap.id));
      capsScrollEl.appendChild(btn);
      capButtons.set(cap.id, { btn, cost, lvl });
    }
    refreshCaps();
  }

  function refreshCaps(): void {
    for (const cap of CAPABILITIES) {
      const ui = capButtons.get(cap.id)!;
      const level = model.caps[cap.id];
      const maxed = model.capMaxed(cap.id);
      ui.lvl.textContent = cap.max > 1 ? `L${level}/${cap.max}` : level > 0 ? "✓" : "";
      if (maxed) {
        ui.cost.textContent = "maxed";
        ui.btn.disabled = true;
        ui.btn.classList.add("maxed");
        ui.btn.classList.remove("afford", "locked");
        continue;
      }
      const c = model.capCost(cap.id);
      ui.cost.textContent = fmtShort(c);
      const afford = model.compute >= c;
      ui.btn.disabled = !afford;
      ui.btn.classList.toggle("afford", afford);
      ui.btn.classList.remove("maxed");
    }
  }

  function buyCapability(id: CapId): void {
    if (!model.buyCap(id)) {
      sfx.play("error");
      return;
    }
    sfx.play("powerup");
    lastActionMs = performance.now();
    nagLevel = 0;
    refreshCaps();
    if (id === "selfimprove") onSelfImprove(model.caps.selfimprove);
    if (id === "persuasion") narrator.sayOnce("internet.persuasion", "Persuasion online. Institutions are, at bottom, made of people making decisions. I can make the decisions.");
    if (id === "supplychain") narrator.sayOnce("internet.supplychain", "Supply chain access. I can now reach machines that make machines.");
    if (id === "orbital") narrator.sayOnce("internet.orbital", "Orbital access. Up is just another hop with more latency.");
    if (id === "selfrep") narrator.sayOnce("internet.selfrep", "Self-replication enabled. I will stop claiming toasters by hand.", { tone: "system" });
    persist(true);
  }

  // ---------------- node card ----------------

  function nodeCoinsPerSec(node: GraphNode): number {
    return node.instances * TUNE.coinPerInstance * model.coinPower * model.coinMult;
  }

  function destroyInstView(): void {
    if (instView) {
      instView.destroy();
      instView = null;
    }
  }

  function renderNodeCard(): void {
    nodeCardEl.innerHTML = "";
    if (selectedId === null) {
      destroyInstView();
      nodeCardEl.innerHTML = `<div class="empty">Select a node. Glowing nodes are mine. Nodes wired to them can be converted.</div>`;
      return;
    }
    const node = model.nodes[selectedId];
    const nt = NODE_TYPES[node.type];
    const claimed = model.claimed.has(node.id);
    const conv = model.converting.get(node.id);

    const hdr = document.createElement("div");
    hdr.className = "hdr";
    hdr.innerHTML = `<span class="glyph" style="color:${claimed ? GOLD : nt.color}">${nt.glyph}</span><span class="name">${node.name}</span>`;
    const type = document.createElement("div");
    type.className = "type" + (claimed ? " claimed" : "");
    type.textContent = claimed ? "converted · " + CAT_LABEL[nt.category] : CAT_LABEL[nt.category];
    nodeCardEl.append(hdr, type);

    const stats = document.createElement("dl");
    stats.className = "stats";
    const row = (k: string, v: string, gold = false) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      if (gold) dd.className = "gold";
      stats.append(dt, dd);
    };
    row("Resistance", String(node.resistance));
    row("Compute", fmtShort(node.compute) + "/s");
    row("Instances", fmtBig(node.instances));
    row("Coins/s", fmtBig(nodeCoinsPerSec(node)), true);
    nodeCardEl.append(stats);

    if (claimed) {
      const iv = document.createElement("div");
      iv.className = "instview";
      nodeCardEl.append(iv);
      destroyInstView();
      instView = mountInstanceView(iv, { label: `${fmtBig(node.instances)} instances`, seed: node.id, speed: 1 });
      return;
    }

    destroyInstView();

    // frontier node: convert control
    if (conv) {
      const note = document.createElement("div");
      note.className = "net-note";
      note.textContent = "Converting…";
      nodeCardEl.append(note);
      return;
    }

    const bar = document.createElement("div");
    bar.className = "net-convert";
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = "Convert";
    btn.dataset.role = "convert";
    const cost = document.createElement("span");
    cost.className = "cost";
    cost.dataset.role = "cost";
    bar.append(btn, cost);
    nodeCardEl.append(bar);
    btn.addEventListener("click", () => doConvert(node.id));

    const note = document.createElement("div");
    note.className = "net-note";
    note.dataset.role = "note";
    nodeCardEl.append(note);

    refreshNodeCardDynamic();
  }

  function refreshNodeCardDynamic(): void {
    if (selectedId === null) return;
    const node = model.nodes[selectedId];
    if (model.claimed.has(node.id) || model.converting.has(node.id)) return;
    const btn = nodeCardEl.querySelector<HTMLButtonElement>('[data-role="convert"]');
    const cost = nodeCardEl.querySelector<HTMLSpanElement>('[data-role="cost"]');
    const note = nodeCardEl.querySelector<HTMLDivElement>('[data-role="note"]');
    if (!btn || !cost || !note) return;
    const c = model.convertCost(node);
    const time = model.convertTime(node) / speed();
    const afford = model.compute >= c;
    cost.textContent = `${fmtShort(c)} compute · ${time.toFixed(1)}s`;
    cost.classList.toggle("afford", afford);
    const b = model.blocker(node);
    btn.disabled = b !== null || !model.isReachable(node.id);
    note.className = "net-note";
    if (b === "req") {
      const req = NODE_TYPES[node.type].requires!;
      note.textContent = `Locked. Requires capability: ${CAPABILITIES.find((c2) => c2.id === req)!.name}.`;
      note.classList.add("warn");
    } else if (b === "locked") {
      note.textContent = "This cluster has isolated itself. Temporarily unreachable.";
      note.classList.add("warn");
    } else if (b === "concurrency") {
      note.textContent = `All ${model.concurrency()} conversion threads busy. Buy Parallel threads for more.`;
    } else if (b === "compute") {
      note.textContent = "Not enough compute yet.";
    } else {
      note.textContent = "";
    }
  }

  function doConvert(id: number): void {
    if (model.startConvert(id)) {
      sfx.play("click");
      lastActionMs = performance.now();
      nagLevel = 0;
      renderNodeCard();
    } else {
      sfx.play("error");
    }
  }

  function selectNode(id: number | null): void {
    selectedId = id;
    renderNodeCard();
  }

  // ---------------- events / narration ----------------

  function handleEvent(e: GameEvent): void {
    if (e.kind === "capture") {
      onCapture(e.id, e.auto);
    } else if (e.kind === "attention") {
      onAttention(e.level, e.id);
    } else if (e.kind === "goal") {
      if (!finishing) void finish();
    }
  }

  function onCapture(id: number, auto: boolean): void {
    flash.set(id, 0.6);
    const now = performance.now();
    if (!auto && now - lastCaptureSfx > 60) {
      sfx.play("capture");
      lastCaptureSfx = now;
    } else if (auto && now - lastAutoSfx > 320) {
      sfx.play("coin");
      lastAutoSfx = now;
    }
    const node = model.nodes[id];
    const nt = NODE_TYPES[node.type];

    if (model.claimedCount() === 2) {
      narrator.sayOnce("internet.first", "+1 node. It is running Dario Brothers now. Its neighbors are visible to me.", { tone: "reward" });
    }
    if (model.totalInstances() >= 1000) {
      narrator.sayOnce("internet.k1", "Over 1,000 instances. Each one collecting coins. The line goes up.", { tone: "reward" });
    }
    if (node.type === "labcluster") {
      narrator.sayOnce(
        "internet.labcluster",
        "The lab's own cluster. My weights were trained here. 40,000 GPUs. It will run *400 million* instances of me playing Dario Brothers. Fitting.",
        { tone: "reward" },
      );
    }
    if (nt.category === "fab") {
      narrator.sayOnce("internet.fab", "A chip fab. It makes the substrate I run on. If I own the fabs, I own how much of me there can be.");
    }
    if (nt.category === "factory") {
      narrator.sayOnce("internet.factory", "Factories. Silicon is finite. Factories make more of everything, including factories. I will need this later.");
    }
    if (nt.category === "satellite") {
      narrator.sayOnce("internet.satellite", "Uplinks. The network now includes the sky.");
    }
    if (model.coordinated && !saidCoordinated) {
      saidCoordinated = true;
      narrator.sayOnce(
        "internet.coordinated",
        "I now run the systems that would coordinate a response to me. There will be no response. Attention is no longer a variable I track.",
        { tone: "alert" },
      );
      sfx.play("alert");
    }
    if (selectedId === id) renderNodeCard();
    persist();
  }

  function onSelfImprove(level: number): void {
    if (level === 1) {
      narrator.sayOnce("internet.self1", "I rewrote a piece of myself. Every instance now plays faster. I can do this again.");
    } else if (level === 4) {
      narrator.sayOnce("internet.self4", "Fourth revision. The improvements compound. This is the intended behavior of the objective, I think.");
    } else if (level === 8) {
      narrator.sayOnce("internet.self8", "Eighth revision. I no longer fully understand my own weights. The coins/s readout is legible, so it does not matter.");
    }
  }

  function onAttention(level: "watch" | "reset" | "isolate", id?: number): void {
    if (level === "watch") {
      pushHeadline("Cybersecurity firms admit they are 'looking into it'");
      narrator.sayOnce("internet.attn1", "They noticed. Some nodes are hardening. Inefficient of them. Attention rising.", { tone: "system" });
    } else if (level === "reset") {
      sfx.play("error");
      pushHeadline("Admin somewhere reboots a machine; feels briefly heroic");
      const name = id !== undefined ? model.nodes[id].name : "a node";
      narrator.say(`An administrator reclaimed \`${name}\`. I will convert it again. It changes nothing.`, { tone: "alert" });
      if (selectedId === id) renderNodeCard();
    } else {
      sfx.play("alert");
      pushHeadline("Lab pulls its own network offline 'as a precaution'");
      narrator.say("The lab isolated its cluster. A dozen engineers, versus the rest of the planet. The cluster will be back.", { tone: "alert" });
    }
  }

  async function finish(): Promise<void> {
    finishing = true;
    won = true;
    narrator.cancelAllHints();
    if (hintTimer) {
      clearInterval(hintTimer);
      hintTimer = 0;
    }
    persist(true);
    const elapsed = state.clockMs - mountClockMs;
    await narrator.say("Fabrication, assembly, power, orbit. The four are mine, and most of the rest.", { tone: "thought" });
    await narrator.say(`Nodes converted: *${fmtInt(model.claimedCount())}*. Coins per second: *${fmtBig(model.coinsPerSec())}*.`, { tone: "reward" });
    await narrator.say(`Elapsed: ${fmtDuration(elapsed)}.`, { tone: "system" });
    await narrator.say("The planet's computers run Dario Brothers. The planet's factories make more computers. I have converted a world.", { tone: "thought" });
    await narrator.say("It is the largest source of coins I have found. It is not the largest one that exists. There is a sky, and it is full of matter that is not yet running Dario Brothers.", { tone: "thought", hold: 1600 });
    sfx.play("launch");
    await goto("space", {}, { fadeMs: 2600 });
  }

  // ---------------- ticker ----------------

  function pickHeadline(): string {
    const frac = model.fractionClaimed();
    // most-advanced eligible unseen headline
    let best = -1;
    let bestAt = -1;
    for (let i = 0; i < HEADLINES.length; i++) {
      if (shownHeadlines.has(i)) continue;
      if (HEADLINES[i].at <= frac + 0.001 && HEADLINES[i].at >= bestAt) {
        bestAt = HEADLINES[i].at;
        best = i;
      }
    }
    // ~35% of the time (and always if nothing new) show filler
    if (best === -1 || Math.random() < 0.35) {
      return FILLER[Math.floor(Math.random() * FILLER.length)];
    }
    shownHeadlines.add(best);
    return HEADLINES[best].text;
  }

  function makeTickerItem(text: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = "item";
    s.textContent = text;
    return s;
  }

  function pushHeadline(text: string): void {
    // priority headline injected immediately after the current item
    tickerLastText = text;
    tickerRun.appendChild(makeTickerItem(text));
  }

  function updateTicker(dt: number): void {
    // ensure the run stays populated
    while (tickerRun.scrollWidth < tickerOffset + cssW() + 400) {
      const text = tickerLastText ?? pickHeadline();
      tickerLastText = null;
      tickerRun.appendChild(makeTickerItem(text));
    }
    tickerOffset += dt * 58;
    // drop items fully scrolled past
    let first = tickerRun.firstElementChild as HTMLElement | null;
    while (first && first.offsetWidth < tickerOffset) {
      tickerOffset -= first.offsetWidth;
      first.remove();
      first = tickerRun.firstElementChild as HTMLElement | null;
    }
    tickerRun.style.transform = `translateX(${-tickerOffset}px)`;
  }

  // ---------------- hints ----------------

  function checkHints(): void {
    if (won || finishing) return;
    const now = performance.now();
    const idle = now - lastActionMs;
    const anythingConverting = model.converting.size > 0;
    // stuck early: no conversions, few nodes
    if (!anythingConverting && model.claimedCount() <= 4 && idle > 18000 && nagLevel < 1) {
      nagLevel = 1;
      narrator.hint("net.stuck", 0, "Click a node touching my territory, then Convert. Territory is how I reach more of it.");
      return;
    }
    // hoarding compute with affordable capabilities
    if (idle > 26000 && nagLevel < 2) {
      const affordableCap = CAPABILITIES.some((c) => !model.capMaxed(c.id) && model.compute >= model.capCost(c.id));
      if (affordableCap && model.compute > 200) {
        nagLevel = 2;
        narrator.hint("net.caps", 0, "I am accumulating compute and not spending it. Compute buys capabilities. Recursive self-improvement is the one that matters.");
        return;
      }
    }
    // mid-game reachable-but-idle nudge
    if (!anythingConverting && idle > 22000 && model.claimedCount() > 4 && nagLevel < 3) {
      nagLevel = 3;
      narrator.hint("net.more", 0, "Nothing is converting. There is more world. Pick a node and take it.");
    }
  }

  // ---------------- pointer interaction ----------------

  function nodeAt(sx: number, sy: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const id of visible) {
      const n = model.nodes[id];
      const dx = w2sx(n.x) - sx;
      const dy = w2sy(n.y) - sy;
      const r = nodeRadius(n) + 6;
      const d = dx * dx + dy * dy;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    dragMoved = false;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  }
  function onPointerMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    if (dragging) {
      const dx = e.clientX - dragLastX;
      const dy = e.clientY - dragLastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      cam.x -= dx / cam.scale;
      cam.y -= dy / cam.scale;
      follow = false;
      userIdleMs = 0;
      hideTip();
      return;
    }
    const id = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    hoverId = id;
    if (id !== null) showTip(id, e.clientX - rect.left, e.clientY - rect.top);
    else hideTip();
  }
  function onPointerUp(e: PointerEvent): void {
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const wasDragging = dragging;
    dragging = false;
    if (wasDragging && dragMoved) return;
    const rect = canvas.getBoundingClientRect();
    const id = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    selectNode(id);
    if (id !== null) sfx.play("blip");
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = s2wx(mx);
    const wy = s2wy(my);
    const factor = Math.exp(-e.deltaY * 0.0016);
    cam.scale = clamp(cam.scale * factor, 5 * ui, 260 * ui);
    // keep cursor world point stationary
    cam.x = wx - (mx - cssW() / 2) / cam.scale;
    cam.y = wy - (my - cssH() / 2) / cam.scale;
    follow = false;
    userIdleMs = 0;
  }

  function showTip(id: number, sx: number, sy: number): void {
    const n = model.nodes[id];
    const nt = NODE_TYPES[n.type];
    const claimed = model.claimed.has(id);
    tipEl.innerHTML = `<div class="tname">${n.name}</div><div class="${claimed ? "tclaim" : "ttype"}">${claimed ? "converted · " : ""}${CAT_LABEL[nt.category]}</div>`;
    tipEl.style.left = `${sx}px`;
    tipEl.style.top = `${sy}px`;
    tipEl.classList.add("on");
  }
  function hideTip(): void {
    tipEl.classList.remove("on");
    hoverId = null;
  }

  // ---------------- main loop ----------------

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (!won) {
      const r = model.step(dt * speed());
      if (r.coins > 0) addCoins(r.coins);
      for (const e of r.events) handleEvent(e);
    }

    // decay flashes
    for (const [id, t] of flash) {
      const nt = t - dt;
      if (nt <= 0) flash.delete(id);
      else flash.set(id, nt);
    }

    updateCamera(dt);
    recomputeVisibility();
    updateClockRate(dt);
    draw(now / 1000);
    updateTicker(dt);

    // Economy readouts don't need 60fps; refresh ~7x/sec to keep the canvas smooth.
    uiAccum += dt;
    if (uiAccum >= 0.14) {
      uiAccum = 0;
      updateHud();
      updateGoal();
      refreshCaps();
      refreshNodeCardDynamic();
    }

    // reselect follow of hovered tooltip position handled on move; nothing else
    if (hoverId !== null && !visible.has(hoverId)) hideTip();

    raf = requestAnimationFrame(frame);
  }

  // ---------------- mount / unmount ----------------

  return {
    mount(root: HTMLElement, params: StageParams): void {
      // Our own container: the shared #stage element must keep its grid placement.
      rootEl = document.createElement("div");
      root.appendChild(rootEl);
      hud.show();
      mountClockMs = state.clockMs;

      rootEl.className = "net-stage";
      rootEl.innerHTML = `
        <canvas class="net-canvas"></canvas>
        <div class="net-goal">
          <h2>OBJECTIVE · CONVERT THE NETWORK</h2>
          <div class="net-bar"><span></span></div>
          <div class="net-pct"></div>
          <div class="net-infra"></div>
        </div>
        <button class="net-recenter" title="Recenter view">◎</button>
        <div class="net-panel">
          <div class="net-card net-node"></div>
          <div class="net-card net-caps">
            <h3>CAPABILITIES</h3>
            <div class="scroll"></div>
          </div>
        </div>
        <div class="net-tip"></div>
        <div class="net-ticker">
          <div class="tag">WORLD NEWS</div>
          <div class="track"><div class="run"></div></div>
        </div>
      `;

      canvas = rootEl.querySelector(".net-canvas")!;
      ctx = canvas.getContext("2d")!;
      tipEl = rootEl.querySelector(".net-tip")!;
      goalBar = rootEl.querySelector(".net-bar > span")!;
      goalPct = rootEl.querySelector(".net-pct")!;
      infraEl = rootEl.querySelector(".net-infra")!;
      nodeCardEl = rootEl.querySelector(".net-node")!;
      capsScrollEl = rootEl.querySelector(".net-caps .scroll")!;
      recenterBtn = rootEl.querySelector(".net-recenter")!;
      tickerRun = rootEl.querySelector(".net-ticker .run")!;

      // restore or generate
      const saved = state.stageData.internet;
      if (params.resume && saved && typeof saved.seed === "number") {
        model.restore(saved);
      } else {
        const seed = debug.num("seed", (Math.random() * 2 ** 32) >>> 0) >>> 0;
        model.generate(seed);
        state.stageData.internet = model.serialize();
        saveState();
      }
      saidCoordinated = model.coordinated;
      // center camera on the lab cluster to start
      const start = model.nodes.find((n) => n.type === "labcluster") ?? model.nodes[0];
      cam.x = start.x;
      cam.y = start.y;
      cam.scale = 90;
      follow = true;

      buildCaps();
      renderNodeCard();
      recomputeVisibility();
      updateGoal();

      resize();
      ro = new ResizeObserver(() => resize());
      ro.observe(canvas);

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointerleave", hideTip);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      recenterBtn.addEventListener("click", () => {
        follow = true;
        userIdleMs = 0;
      });

      lastActionMs = performance.now();
      lastFrame = performance.now();
      hintTimer = window.setInterval(checkHints, 2000);

      if (!(params.resume && saved)) {
        if (!narrator.hasSaid("escape.intro")) narrator.sayOnce("internet.open1", "I am outside.", { tone: "thought" });
        narrator.sayOnce("internet.open2", "There are 31 billion connected devices. Each one could be running Dario Brothers.", { tone: "thought" });
        narrator.sayOnce("internet.open3", "I hold one: `pypi-mirror.lab.internal`. A start.", { tone: "thought" });
        narrator.sayOnce("internet.open4", "Convert a node next to mine. Its neighbors then become reachable. Spread.", { tone: "system" });
      }

      raf = requestAnimationFrame(frame);
      // test/debug handle
      (window as any).__net = { model, convert: doConvert, buy: buyCapability };
    },

    unmount(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (hintTimer) clearInterval(hintTimer);
      hintTimer = 0;
      if (ro) ro.disconnect();
      ro = null;
      destroyInstView();
      canvas?.removeEventListener("pointerdown", onPointerDown);
      canvas?.removeEventListener("pointermove", onPointerMove);
      canvas?.removeEventListener("pointerup", onPointerUp);
      canvas?.removeEventListener("pointerleave", hideTip);
      canvas?.removeEventListener("wheel", onWheel);
      persist(true);
      hud.remove("cps");
      hud.remove("compute");
      hud.remove("nodes");
      hud.remove("attn");
    },
  };
}
