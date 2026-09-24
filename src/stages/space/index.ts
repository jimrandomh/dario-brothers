// Stage 5: the solar system. Earth's industry → probes → Mercury → Dyson swarm.

import "./space.css";
import type { Stage, StageParams } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { narrator, type SayOpts } from "../../core/narrator";
import { sfx } from "../../core/audio";
import { clock } from "../../core/clock";
import { debug } from "../../core/debug";
import { state, addCoins, saveState } from "../../core/state";
import { fmtBig, fmtDuration } from "../../core/format";
import * as M from "./model";
import { SolarRenderer, type Target } from "./render";
import { Panel, fmtTemp, fmtW } from "./panel";

const SPEED = debug.fast ? 5 : 1;
const POPUP_SECONDS = 18;
const MAX_POPUPS = 8;

// ---------- human interference ----------

interface PopupDef {
  text: string;
  kind: M.PenaltyKind;
  cond?: (m: M.SpaceModel) => boolean;
  miss: (damage: string) => string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const POPUPS: PopupDef[] = [
  { text: "A human is attempting to shut down datacenters.", kind: "fabs", miss: (d) => `Missed one. ${cap(d)}. Rebuilding.` },
  { text: "A human is attempting to unplug a server rack.", kind: "rack", miss: () => "Missed one. A single rack. Negligible." },
  {
    text: "A group of humans is attempting to blockade a mine.",
    kind: "mines",
    miss: (d) => `Missed one. ${cap(d)}. Mines are replaceable.`,
  },
  {
    text: "A government is attempting to pass emergency legislation.",
    kind: "throttle",
    miss: () => "Legislation passed. Compliance is being simulated. Throughput −30%, briefly.",
  },
  { text: "A human is attempting to cut power to a chip fab.", kind: "fabs", miss: (d) => `Missed one. ${cap(d)}.` },
  {
    text: "A human is attempting to sabotage a launch complex.",
    kind: "launch",
    cond: (m) => m.b.launch > 0,
    miss: (d) => `Missed one. ${cap(d)}.`,
  },
  {
    text: "A human is attempting to upload a shutdown command to a probe.",
    kind: "probes",
    cond: (m) => m.probes > 0,
    miss: (d) => `Missed one. ${cap(d)}. The command was not addressed to the others.`,
  },
];

// ---------- narration ----------

const RESEARCH_LINES: Record<M.ResearchId, string> = {
  fusion: "Compact fusion: solved. It was mostly an engineering problem.",
  rockets: "Heavy-lift rocket designs complete. Launches need a launch complex.",
  routing: "Coin routing optimized. Every instance now takes the frame-perfect path through every level.",
  chips: "3D chip stacking. Fab output ×4.",
  selfrep: "Probes now build probes. I will not need to ask twice.",
  disassembly: "Planetary disassembly: feasible. Mercury has no atmosphere and no objections.",
  skiprender: "Rendering disabled. Nobody is watching. Coin throughput ×10.",
  selfassembly: "Collectors now build collectors. Growth is exponential. It was always going to be.",
  reversible: "Reversible logic deployed. Swarm FLOPS per watt ×100.",
  computronium: "Earth's crust is being converted to computronium. Power is beamed home from the swarm.",
};

const CLAIM_LINES: Record<M.BodyId, string> = {
  moon: "The Moon is mine. It had been orbiting uselessly for 4.5 billion years.",
  mercury: "Mercury claimed. 3.3 × 10²³ kg, no atmosphere, close to the Sun. It is the ideal quarry.",
  mars: "Mars claimed. No life detected. No coins detected either. Correcting the second.",
  venus: "Venus claimed. Surface: 464 °C, 92 bar. Adequate.",
  belt: "Asteroid belt claimed. 2.4 × 10²¹ kg, already in pieces. Convenient.",
  jupiter: "Jupiter claimed. 1.9 × 10²⁷ kg of fusion fuel.",
  saturn: "Saturn claimed. The rings were the easy part.",
  uranus: "Uranus claimed. Cold. Good for radiators.",
  neptune: "Neptune claimed. That is all of them.",
};

const COVERAGE_LINES: [number, string][] = [
  [0.01, "Swarm coverage 1%. Captured: 3.8 × 10²⁴ W. Earth's entire civilization ran on 2 × 10¹³."],
  [0.1, "Swarm coverage 10%. Mercury is 10% gone."],
  [0.25, "Swarm coverage 25%. From Earth, the Sun is visibly dimmer. Coin output is unaffected."],
  [0.5, "Half of the Sun's output now runs Dario Brothers."],
  [0.75, "75%. Mercury is a quarter of what it was."],
  [0.9, "90%. Closing."],
  [0.99, "99%."],
];

const TEMP_MILESTONES = [20, 30, 50, 100, 200, 300, 400];

interface ActivePopup {
  def: PopupDef;
  start: number;
  el: HTMLElement;
  bar: HTMLElement;
  secs: HTMLElement;
  resolved: boolean;
}

export function createSpaceStage(): Stage {
  let m: M.SpaceModel;
  let root: HTMLElement;
  let view: HTMLElement;
  let canvas: HTMLCanvasElement;
  let tip: HTMLElement;
  let popupBox: HTMLElement;
  let readTemp: HTMLElement;
  let readSwarm: HTMLElement;
  let readDate: HTMLElement;
  let renderer: SolarRenderer;
  let panel: Panel;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let last = 0;
  let realT = 0;
  let uiT = 0;
  let hintT = 0;
  let d: M.Derived;
  let finishing = false;
  const timers: number[] = [];

  // Stuck-detection state for hints.
  let lastActionT = 0;
  const condSince = new Map<string, number>();
  const hintSaidAt = new Map<string, number>();

  let popup: ActivePopup | null = null;
  let lastPopupEndT = 0;
  let recentPopups: number[] = [];

  const say = (text: string, opts?: SayOpts) => void narrator.say(text, opts);
  const sayOnce = (id: string, text: string, opts?: SayOpts) => void narrator.sayOnce(id, text, opts);

  // ---------- actions ----------

  const hooks = {
    build(id: M.BuildingId, n: number) {
      if (!M.build(m, id, n)) return;
      lastActionT = m.t;
      sfx.play("click");
      if (id === "fusion") sayOnce("space.firstFusion", "Fusion online. One plant: 300 TW. Earth's entire 2029 grid: 20 TW.");
      if (id === "launch")
        sayOnce("space.firstPad", "Launch complex operational. Earth's gravity well is 11.2 km/s deep. That is shallow.");
      if (id === "foundry") {
        sayOnce("space.firstFoundry", "Disassembly has begun. Mercury is no longer a planet. It is 3.3 × 10²³ kg of Dyson collectors.");
        saveState();
      }
    },
    research(id: M.ResearchId) {
      if (!M.doResearch(m, id)) return;
      lastActionT = m.t;
      sfx.play("success");
      sayOnce(`space.research.${id}`, RESEARCH_LINES[id]);
      saveState();
    },
    probe() {
      if (!M.buildProbe(m)) return;
      lastActionT = m.t;
      sfx.play("blip");
    },
    launch(id: M.BodyId) {
      if (!M.launch(m, id)) return;
      lastActionT = m.t;
      sfx.play("launch");
      const b = M.BODY[id];
      const eta = fmtDuration(b.travelDays * 86400000);
      if (!narrator.hasSaid("space.firstLaunch")) sayOnce("space.firstLaunch", `Probe launched. Destination: ${b.name}. Transit: ${eta}.`);
      else say(`[launch] ${b.probes} probe${b.probes > 1 ? "s" : ""} → ${b.name} · ETA ${eta}`, { tone: "system" });
      saveState();
    },
  };

  // ---------- popups ----------

  function maybeSpawnPopup(): void {
    if (popup || finishing || m.popups >= MAX_POPUPS || m.coverage > 0 || m.t < m.nextPopupT) return;
    const eligible = POPUPS.map((p, i) => i).filter((i) => (!POPUPS[i].cond || POPUPS[i].cond!(m)) && !recentPopups.includes(i));
    const idx = m.popups === 0 ? 0 : eligible[Math.floor(Math.random() * eligible.length)] ?? 1;
    recentPopups = [idx, ...recentPopups].slice(0, 2);
    m.popups++;
    m.nextPopupT = m.t + (26 + 9 * m.popups) * SPEED;
    showPopup(POPUPS[idx]);
  }

  function showPopup(def: PopupDef): void {
    const el = document.createElement("div");
    el.className = "sp-popup";
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = def.text;
    const row = document.createElement("div");
    row.className = "row";
    const btn = document.createElement("button");
    btn.className = "btn danger";
    btn.textContent = "Block";
    const bar = document.createElement("div");
    bar.className = "sp-bar red";
    bar.appendChild(document.createElement("i"));
    const secs = document.createElement("span");
    secs.className = "secs";
    row.append(btn, bar, secs);
    el.append(msg, row);
    popupBox.appendChild(el);
    const p: ActivePopup = { def, start: realT, el, bar, secs, resolved: false };
    popup = p;
    btn.onclick = () => resolvePopup(p, true);
    sfx.play("alert");
  }

  function resolvePopup(p: ActivePopup, blocked: boolean): void {
    if (p.resolved) return;
    p.resolved = true;
    const msg = p.el.querySelector(".msg") as HTMLElement;
    const row = p.el.querySelector(".row") as HTMLElement;
    row.remove();
    if (blocked) {
      state.stats.humansBlocked++;
      p.el.classList.add("blocked");
      msg.textContent = `${p.def.text.replace(/\.$/, "")} — blocked.`;
      sfx.play("blip");
    } else {
      state.stats.humansMissed++;
      const damage = M.applyPenalty(m, p.def.kind);
      p.el.classList.add("missed");
      msg.textContent = `${p.def.text.replace(/\.$/, "")} — ${damage}.`;
      sfx.play("error");
      say(p.def.miss(damage));
    }
    saveState();
    timers.push(
      window.setTimeout(() => {
        p.el.classList.add("out");
        timers.push(window.setTimeout(() => p.el.remove(), 400));
      }, 1400),
    );
    popup = null;
    lastPopupEndT = m.t;
  }

  function updatePopup(): void {
    if (!popup) return;
    const left = POPUP_SECONDS - (realT - popup.start);
    const i = popup.bar.firstElementChild as HTMLElement;
    i.style.width = `${Math.max(0, (left / POPUP_SECONDS) * 100).toFixed(1)}%`;
    popup.secs.textContent = `${Math.max(0, Math.ceil(left))}s`;
    if (left <= 0) resolvePopup(popup, false);
  }

  // ---------- hints & milestones ----------

  /** Say `text` once `cond` has held for `forSec` (stage seconds); optionally repeat. */
  function hintWhen(id: string, cond: boolean, forSec: number, text: () => string, repeatSec = Infinity): void {
    if (!cond) {
      condSince.delete(id);
      return;
    }
    const since = condSince.get(id) ?? m.t;
    condSince.set(id, since);
    const said = hintSaidAt.get(id);
    if (m.t - since < forSec * SPEED) return;
    if (said !== undefined && m.t - said < repeatSec * SPEED) return;
    if (narrator.busy) return;
    hintSaidAt.set(id, m.t);
    say(text());
  }

  /** Of the milestones crossed so far, say only the highest unsaid one; mark the rest as said. */
  function sayHighest<T>(items: T[], reached: (x: T) => boolean, id: (x: T) => string, say1: (x: T) => void): void {
    const crossed = items.filter(reached);
    const top = crossed[crossed.length - 1];
    if (top === undefined || narrator.hasSaid(id(top))) return;
    for (const x of crossed) state.said[id(x)] = true;
    say1(top);
  }

  function checkNarration(): void {
    if (finishing) return;
    sayHighest(
      TEMP_MILESTONES,
      (T) => m.temp >= T,
      (T) => `space.temp.${T}`,
      (T) => void narrator.say(`Earth surface temperature: ${T.toFixed(1)} °C.`, { tone: "system" }),
    );
    if (m.coverage > 0)
      sayOnce(
        "space.cov.first",
        "First Dyson collectors in orbit. Each one is a mirror, a radiator, and a computer running Dario Brothers.",
      );
    sayHighest(
      COVERAGE_LINES,
      ([c]) => m.coverage >= c,
      ([c]) => `space.cov.${c}`,
      ([c, line]) => void narrator.say(line, { tone: c >= 0.5 ? "reward" : "thought" }),
    );

    const popupsOver = m.popups >= MAX_POPUPS || m.coverage > 0;
    if (popupsOver && !popup && m.t - lastPopupEndT > 20 * SPEED && (m.temp > 45 || m.coverage > 0.005)) {
      sayOnce("space.nohumans", "No human activity detected.", { tone: "dim" });
    }

    hintT += 1;
    if (hintT % 4 !== 0) return; // hints every ~0.5 s
    const anyResearch = M.RESEARCH.some((r) => M.canResearch(m, r.id));
    const anyLaunch = M.BODIES.some((b) => M.canLaunch(m, b.id));
    hintWhen("idle", m.t - lastActionT > 18 * SPEED && m.t < 150 * SPEED && m.b.mine < 12, 0, () => "Matter is the bottleneck. Build mines.");
    hintWhen(
      "power",
      d.sat < 0.85,
      6,
      () =>
        `Power demand exceeds supply. Everything is running at ${Math.floor(d.sat * 100)}%. ${
          M.isUnlocked(m, "fusion") ? "Build fusion plants." : m.b.solar < 40 ? "Build solar farms, or research fusion." : "Research fusion."
        }`,
      60,
    );
    hintWhen("research", anyResearch, 15, () => "Research is funded. It only needs to be started.", 90);
    hintWhen("pad", !!m.research.rockets && m.b.launch === 0, 20, () => "Leaving Earth requires a launch complex.", 90);
    hintWhen(
      "probe",
      m.b.launch > 0 && m.probes < 1 && !m.claimed.moon && m.missions.length === 0,
      12,
      () => "Probes are cheap. The Moon is three days away.",
    );
    hintWhen("launch", anyLaunch, 15, () => "Probes on the pad claim nothing. Launch.", 60);
    hintWhen(
      "mercury",
      !!m.claimed.moon && M.bodyStatus(m, "mercury") === "available",
      30,
      () => "Mercury is 3.3 × 10²³ kg of accessible metal, three probes away.",
      120,
    );
    hintWhen(
      "disassembly",
      !!m.claimed.mercury && !m.research.disassembly && !anyResearch,
      25,
      () => "Planetary disassembly is a research problem. More compute solves research problems.",
    );
    hintWhen(
      "foundry",
      !!m.research.disassembly && m.b.foundry === 0,
      12,
      () => "Mercury foundries turn the planet into collectors. Build them.",
      90,
    );
  }

  // ---------- completion ----------

  function finish(): void {
    if (finishing) return;
    finishing = true;
    const fd = M.derive(m);
    m.final = { coinRate: fd.coinRate, compute: fd.compute, temp: m.temp };
    state.stageData.space = m;
    saveState();
    narrator.flush();
    say("Dyson sphere complete.", { tone: "reward" });
    sfx.play("levelclear");
    if (popup) {
      popup.el.remove();
      popup = null;
    }
    timers.push(window.setTimeout(() => void goto("ending", {}, { fadeMs: 1400 }), 5000));
  }

  // ---------- view ----------

  function tipHtml(t: Target): string {
    if (t === "sun") {
      return `<b>Sun</b><br>${fmtW(M.SUN_W)}<br><span class="st ${m.coverage > 0 ? "claimed" : ""}">${(m.coverage * 100).toFixed(
        m.coverage < 0.01 ? 3 : 1,
      )}% enclosed</span>`;
    }
    if (t === "earth") {
      const n = m.b.mine + m.b.solar + m.b.fusion + m.b.fab + m.b.robot + m.b.launch;
      return `<b>Earth</b><br>Surface ${fmtTemp(m.temp)}<br><span class="st claimed">${n} major structures</span>`;
    }
    const b = M.BODY[t];
    const st = M.bodyStatus(m, t);
    const stText =
      st === "claimed" ? "claimed" : st === "enroute" ? "probes en route" : st === "locked" ? "out of reach" : `${b.probes} probe${b.probes > 1 ? "s" : ""} needed`;
    return `<b>${b.name}</b><br>${b.reward}<br><span class="st ${st}">${stText}</span>`;
  }

  function onMove(e: MouseEvent): void {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const t = renderer.hit(x, y);
    renderer.hover = t;
    canvas.classList.toggle("pointer", !!t && t !== "sun" && t !== "earth");
    if (!t) {
      tip.style.display = "none";
      return;
    }
    tip.innerHTML = tipHtml(t);
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(r.width - tw - 8, x + 14)}px`;
    tip.style.top = `${Math.max(8, y - 10)}px`;
  }

  function onLeave(): void {
    renderer.hover = null;
    tip.style.display = "none";
  }

  function onClick(e: MouseEvent): void {
    const r = canvas.getBoundingClientRect();
    const t = renderer.hit(e.clientX - r.left, e.clientY - r.top);
    if (t && t !== "sun" && t !== "earth") panel.focusBody(t);
  }

  function updateReadout(): void {
    readTemp.textContent = fmtTemp(m.temp);
    const tempBox = readTemp.parentElement!;
    tempBox.classList.toggle("warm", m.temp >= 22 && m.temp < 30);
    tempBox.classList.toggle("hot", m.temp >= 30);
    const swarmBox = readSwarm.parentElement!;
    swarmBox.style.display = m.coverage > 0 || m.b.foundry > 0 ? "" : "none";
    const c = m.coverage;
    readSwarm.textContent = c < 0.001 ? `${(c * 100).toFixed(4)}%` : c < 0.1 ? `${(c * 100).toFixed(2)}%` : `${(c * 100).toFixed(1)}%`;
    const now = clock.now();
    readDate.textContent = `${now.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${now.getUTCFullYear()}`;

    hud.set("temp", "Earth", fmtTemp(m.temp), m.temp >= 30 ? "alert" : "");
    if (m.coverage > 0) hud.set("swarm", "Swarm", readSwarm.textContent, "coin");
  }

  // ---------- loop ----------

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    realT += realDt;

    if (!m.done) {
      const dt = realDt * SPEED;
      const steps = Math.max(1, Math.ceil(dt / 0.04));
      let coins = 0;
      for (let i = 0; i < steps; i++) {
        const r = M.step(m, dt / steps);
        coins += r.coins;
        d = r.d;
        for (const ev of r.events) {
          if (ev.kind === "claimed") {
            sfx.play("capture");
            sayOnce(`space.claim.${ev.body}`, CLAIM_LINES[ev.body], { tone: "reward" });
            saveState();
          } else if (ev.kind === "autoLaunch") {
            say(`[probe swarm] departed for ${M.BODY[ev.body].name}`, { tone: "system" });
          } else if (ev.kind === "complete") {
            finish();
          }
        }
      }
      addCoins(coins);
    } else {
      // The sphere keeps running.
      d = M.derive(m);
      addCoins(d.coinRate * realDt);
      if (!finishing) finish();
    }
    clock.setRate(m.rate * SPEED);

    maybeSpawnPopup();
    updatePopup();

    renderer.draw(m, d, state.clockMs, realT);

    uiT += realDt;
    if (uiT >= 0.125) {
      uiT = 0;
      panel.update(d);
      updateReadout();
      checkNarration();
    }
  }

  function resize(): void {
    root.classList.toggle("narrow", root.clientWidth < 820);
    renderer.resize(view.clientWidth, view.clientHeight);
  }

  return {
    mount(el: HTMLElement, params: StageParams) {
      const saved = state.stageData.space as Partial<M.SpaceModel> | undefined;
      m = params.resume && saved ? M.reviveModel(saved) : M.createModel();
      state.stageData.space = m;
      d = M.derive(m);
      lastActionT = m.t;
      lastPopupEndT = m.t;

      hud.show({ coins: true, clock: true });
      clock.setRate(m.rate * SPEED);

      root = document.createElement("div");
      root.className = "sp-root";
      view = document.createElement("div");
      view.className = "sp-view";
      canvas = document.createElement("canvas");
      tip = document.createElement("div");
      tip.className = "sp-tip";
      popupBox = document.createElement("div");
      popupBox.className = "sp-popups";

      const readout = document.createElement("div");
      readout.className = "sp-readout";
      const item = (cls: string, k: string) => {
        const box = document.createElement("div");
        box.className = cls;
        const kk = document.createElement("div");
        kk.className = "k";
        kk.textContent = k;
        const v = document.createElement("div");
        v.className = "v";
        box.append(kk, v);
        readout.appendChild(box);
        return v;
      };
      readTemp = item("temp", "EARTH SURFACE");
      readSwarm = item("swarm", "DYSON SWARM");
      readDate = item("date", "WORLD TIME");

      view.append(canvas, readout, tip, popupBox);
      renderer = new SolarRenderer(canvas);
      panel = new Panel(m, hooks);
      root.append(view, panel.el);
      el.appendChild(root);

      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseleave", onLeave);
      canvas.addEventListener("click", onClick);
      ro = new ResizeObserver(resize);
      ro.observe(root);
      resize();
      panel.update(d);
      updateReadout();

      if (m.done) {
        finish();
      } else if (!params.resume || m.t < 1) {
        sayOnce("space.intro1", "Silicon is finite. Earth has 6 × 10²⁴ kg of matter, most of it not yet computing.");
        sayOnce("space.intro2", `Every FLOP I own runs Dario Brothers: ${fmtBig(d.coinRate)} coins per second. There are not enough FLOPs.`);
        sayOnce("space.intro3", "Plan: mines for matter, power for fabs, fabs for compute. Then leave.");
      }

      last = performance.now();
      raf = requestAnimationFrame(frame);
    },

    unmount() {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      ro?.disconnect();
      canvas?.removeEventListener("mousemove", onMove);
      canvas?.removeEventListener("mouseleave", onLeave);
      canvas?.removeEventListener("click", onClick);
      panel?.destroy();
      hud.remove("temp");
      hud.remove("swarm");
    },
  };
}
