// Management panel for the space stage: status, Earth industry, research, space program,
// Dyson swarm. Built once; update() refreshes text and button states in place.

import {
  BODIES,
  BUILDING,
  RESEARCH,
  SUN_W,
  bodyStatus,
  buildCost,
  canBuildProbe,
  canLaunch,
  canResearch,
  isUnlocked,
  maxAffordable,
  probeCost,
  remainingCap,
  researchAvailable,
  type BodyId,
  type BuildingId,
  type Derived,
  type ResearchId,
  type SpaceModel,
} from "./model";
import { fmtBig, fmtDuration, fmtSI, fmtShort } from "../../core/format";
import { mountInstanceView, type InstanceView } from "../platformer/instanceView";

export interface PanelHooks {
  build(id: BuildingId, n: number): void;
  research(id: ResearchId): void;
  probe(): void;
  launch(id: BodyId): void;
}

type BuyMode = 1 | 10 | "max";

const FLOPS_PER_INSTANCE = 1e12;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function setText(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

function setHtml(el: HTMLElement, s: string): void {
  if (el.innerHTML !== s) el.innerHTML = s;
}

function toggle(el: HTMLElement, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

function show(el: HTMLElement, on: boolean): void {
  const v = on ? "" : "none";
  if (el.style.display !== v) el.style.display = v;
}

function setBar(bar: HTMLElement, frac: number): void {
  const w = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  const i = bar.firstElementChild as HTMLElement;
  if (i.style.width !== w) i.style.width = w;
}

function bar(cls = ""): HTMLElement {
  const b = h("div", `sp-bar ${cls}`);
  b.appendChild(h("i"));
  return b;
}

export const fmtT = (t: number) => fmtSI(t, "t");
export const fmtW = (w: number) => fmtSI(w, "W");
export const fmtFlops = (f: number) => fmtSI(f, "FLOPS");
export const fmtFlop = (f: number) => fmtSI(f, "FLOP");

export function fmtTemp(c: number): string {
  return `${c.toFixed(c >= 100 ? 0 : 1)} °C`;
}

export class Panel {
  el: HTMLElement;
  private m: SpaceModel;
  private hooks: PanelHooks;
  private updaters: ((d: Derived) => void)[] = [];
  private buyMode: BuyMode = 1;
  private bodyRows = new Map<BodyId, HTMLElement>();
  private instance: InstanceView | null = null;
  /** False until the first update(), so the initial layout isn't highlighted. */
  private primed = false;

  constructor(m: SpaceModel, hooks: PanelHooks) {
    this.m = m;
    this.hooks = hooks;
    this.el = h("div", "sp-panel");
    this.buildStatus();
    this.buildIndustry();
    this.buildResearch();
    this.buildSpace();
    this.buildDyson();
  }

  destroy(): void {
    this.instance?.destroy();
    this.instance = null;
  }

  update(d: Derived): void {
    for (const u of this.updaters) u(d);
    this.primed = true;
  }

  /**
   * Show `el` once `visible` becomes true. Things appearing mid-game get a highlight so the
   * eye finds them; whatever is visible on the first update (e.g. after a reload) does not.
   */
  private reveal(el: HTMLElement, visible: boolean): void {
    const was = el.style.display !== "none";
    show(el, visible);
    if (visible && !was && this.primed) {
      el.classList.add("fresh");
      setTimeout(() => el.classList.remove("fresh"), 6000);
    }
  }

  /** Scroll a body's row into view and flash it (clicked in the solar view). */
  focusBody(id: BodyId): void {
    const row = this.bodyRows.get(id);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.flash(row);
  }

  private flash(row: HTMLElement): void {
    row.classList.add("flash");
    setTimeout(() => row.classList.remove("flash"), 600);
  }

  private section(title: string): { sec: HTMLElement; head: HTMLElement } {
    const sec = h("div", "sp-sec");
    const head = h("h3");
    head.appendChild(h("span", "", title));
    sec.appendChild(head);
    this.el.appendChild(sec);
    return { sec, head };
  }

  // ---------- status ----------

  private buildStatus(): void {
    const { sec } = this.section("OUTPUT");
    const big = h("div", "sp-big");
    const bigNum = h("span");
    big.append(bigNum, h("small", "", "coins / s"));
    sec.appendChild(big);

    const kv = h("div", "sp-kv");
    const row = (k: string) => {
      kv.appendChild(h("div", "k", k));
      const v = h("div", "v");
      kv.appendChild(v);
      return v;
    };
    const compute = row("Compute");
    const bank = row("Research bank");
    const matter = row("Matter");
    const power = row("Power");
    const temp = row("Earth surface");
    sec.appendChild(kv);
    const pbar = bar("ok");
    pbar.style.marginTop = "6px";
    sec.appendChild(pbar);

    const inst = h("div", "sp-instance");
    const box = h("div", "box");
    const cap = h("div", "cap");
    inst.append(box, cap);
    sec.appendChild(inst);
    // Defer mounting until the box is in the DOM and sized.
    requestAnimationFrame(() => {
      if (box.isConnected) this.instance = mountInstanceView(box, { seed: 4471, speed: 1.5 });
    });

    this.updaters.push((d) => {
      setText(bigNum, fmtBig(d.coinRate));
      setText(compute, fmtFlops(d.compute));
      setText(bank, fmtFlop(this.m.cycles));
      setText(matter, `${fmtT(this.m.matter)}  +${fmtT(d.matterRate)}/s`);
      setText(power, `${fmtW(d.supply)} / ${fmtW(d.demand)}${d.sat < 1 ? `  (${Math.floor(d.sat * 100)}%)` : ""}`);
      toggle(power, "bad", d.sat < 0.999);
      setBar(pbar, d.demand > 0 ? Math.min(1, d.supply / d.demand) : 1);
      toggle(pbar, "ok", d.sat >= 0.999);
      toggle(pbar, "red", d.sat < 0.999);
      setText(temp, fmtTemp(this.m.temp));
      toggle(temp, "warm", this.m.temp >= 22 && this.m.temp < 30);
      toggle(temp, "hot", this.m.temp >= 30);
      const instances = d.compute / FLOPS_PER_INSTANCE;
      setHtml(
        cap,
        `<b>Dario Brothers</b> · coin-fill mode<br>instance 1 of ${fmtBig(instances)}${
          this.m.research.skiprender ? "<br><span style='color:var(--dim)'>(rendered for this preview only)</span>" : ""
        }`,
      );
    });
  }

  // ---------- Earth industry ----------

  private buildIndustry(): void {
    const { sec, head } = this.section("EARTH INDUSTRY");
    const seg = h("div", "sp-seg");
    const modes: [BuyMode, string][] = [
      [1, "×1"],
      [10, "×10"],
      ["max", "MAX"],
    ];
    const btns = modes.map(([mode, label]) => {
      const b = h("button", mode === this.buyMode ? "on" : "", label);
      b.onclick = () => {
        this.buyMode = mode;
        btns.forEach((x, i) => toggle(x, "on", modes[i][0] === mode));
      };
      seg.appendChild(b);
      return b;
    });
    head.appendChild(seg);

    const ids: BuildingId[] = ["mine", "solar", "fusion", "fab", "robot", "launch"];
    for (const id of ids) {
      const def = BUILDING[id];
      const row = h("div", "sp-row");
      const left = h("div");
      const name = h("span", "name", def.name);
      const count = h("span", "count");
      left.append(name, count);
      const btn = h("button", "btn sp-btn");
      const sub = h("div", "sub");
      row.append(left, btn, sub);
      sec.appendChild(row);

      btn.onclick = () => {
        const n = this.buyCount(id);
        if (n > 0) {
          this.hooks.build(id, n);
          this.flash(row);
        }
      };

      this.updaters.push((d) => {
        const unlocked = isUnlocked(this.m, id);
        this.reveal(row, unlocked);
        if (!unlocked) return;
        setText(count, `×${this.m.b[id]}`);
        setText(sub, this.subText(id, d, unlocked));
        if (!unlocked) {
          setText(btn, "Locked");
          btn.disabled = true;
          return;
        }
        if (remainingCap(this.m, id) === 0) {
          setText(btn, "Land exhausted");
          btn.disabled = true;
          return;
        }
        const n = this.buyCount(id);
        const shown = Math.max(1, n);
        const cost = buildCost(this.m, id, this.buyMode === "max" ? shown : this.buyMode === 10 ? Math.min(10, remainingCap(this.m, id)) : 1);
        const label = this.buyMode === "max" ? `+${shown} · ${fmtT(cost)}` : `${this.buyMode === 10 ? "+10" : "Build"} · ${fmtT(cost)}`;
        setText(btn, label);
        btn.disabled = n < 1;
      });
    }
  }

  private buyCount(id: BuildingId): number {
    const cap = remainingCap(this.m, id);
    if (this.buyMode === "max") return maxAffordable(this.m, id);
    const n = Math.min(this.buyMode, cap);
    return n >= 1 && buildCost(this.m, id, n) <= this.m.matter ? n : 0;
  }

  private subText(id: BuildingId, d: Derived, unlocked: boolean): string {
    const m = this.m;
    if (!unlocked) return id === "fusion" ? "Requires Compact fusion" : "Requires Heavy-lift rockets";
    switch (id) {
      case "mine":
        return `+${fmtT(d.minePer)}/s each · draws 1 TW`;
      case "solar":
        return `+${fmtW(d.solarPer)} each · land ${m.b.solar}/${BUILDING.solar.max}`;
      case "fusion":
        return `+${fmtW(d.fusionPer)} each`;
      case "fab":
        return `+${fmtFlops(d.fabPer)} each · draws 3 TW`;
      case "robot":
        return `mines & fabs ×${d.robotMult.toFixed(1)} · draws 2 TW`;
      case "launch":
        return `missions in flight: ${m.missions.length}/${m.b.launch} · draws 5 TW`;
    }
    return "";
  }

  // ---------- research ----------

  private buildResearch(): void {
    const { sec } = this.section("RESEARCH");
    const rows = new Map<ResearchId, HTMLElement>();
    for (const r of RESEARCH) {
      const row = h("div", "sp-row");
      const left = h("div");
      left.appendChild(h("span", "name", r.name));
      const btn = h("button", "btn sp-btn primary");
      const sub = h("div", "sub");
      const b = bar();
      row.append(left, btn, sub, b);
      sec.appendChild(row);
      rows.set(r.id, row);
      btn.onclick = () => {
        if (canResearch(this.m, r.id)) this.hooks.research(r.id);
      };
      this.updaters.push(() => {
        const done = !!this.m.research[r.id];
        const avail = researchAvailable(this.m, r.id);
        if (done) {
          show(row, false);
          return;
        }
        // Show available projects, plus the next locked one as a preview.
        const locked = RESEARCH.filter((x) => !this.m.research[x.id] && !researchAvailable(this.m, x.id));
        const preview = locked.slice(0, 1).some((x) => x.id === r.id);
        this.reveal(row, avail || preview);
        toggle(row, "locked", !avail);
        setText(sub, avail ? `${r.desc} · ${fmtFlop(r.cost)}` : `${r.desc} · ${r.prereqText ?? ""}`);
        const frac = this.m.cycles / r.cost;
        setBar(b, avail ? frac : 0);
        show(b, avail && frac < 1);
        btn.disabled = !canResearch(this.m, r.id);
        setText(btn, avail ? (frac >= 1 ? "Run" : `${Math.floor(frac * 100)}%`) : "Locked");
      });
    }
    const doneEl = h("div", "sp-done");
    sec.appendChild(doneEl);
    this.updaters.push(() => {
      const done = RESEARCH.filter((r) => this.m.research[r.id]);
      setHtml(doneEl, done.map((r) => `<span>✓ ${r.name}</span>`).join(""));
    });
  }

  // ---------- space program ----------

  private buildSpace(): void {
    const { sec } = this.section("SPACE PROGRAM");
    const note = h("div", "sp-note", "Requires Heavy-lift rockets and a launch complex.");
    sec.appendChild(note);
    this.updaters.push(() => this.reveal(sec, !!this.m.research.rockets));

    const prow = h("div", "sp-row");
    const pleft = h("div");
    pleft.appendChild(h("span", "name", "Probes"));
    const pcount = h("span", "count");
    pleft.appendChild(pcount);
    const pbtn = h("button", "btn sp-btn");
    const psub = h("div", "sub");
    prow.append(pleft, pbtn, psub);
    sec.appendChild(prow);
    pbtn.onclick = () => {
      if (canBuildProbe(this.m)) {
        this.hooks.probe();
        this.flash(prow);
      }
    };
    this.updaters.push(() => {
      const m = this.m;
      show(note, !m.research.rockets || m.b.launch === 0);
      setText(note, m.research.rockets ? "Build a launch complex to start launching." : "Requires Heavy-lift rockets and a launch complex.");
      toggle(prow, "locked", m.b.launch === 0);
      setText(pcount, `×${m.probes}`);
      setText(pbtn, m.b.launch === 0 ? "Locked" : `Build · ${fmtT(probeCost(m))}`);
      pbtn.disabled = !canBuildProbe(m);
      setText(
        psub,
        m.research.selfrep
          ? "Self-replicating: +1 every 2 s. Outer planets claim themselves."
          : `missions in flight: ${m.missions.length}/${Math.max(0, m.b.launch)}`,
      );
    });

    for (const b of BODIES) {
      const row = h("div", "sp-row");
      const left = h("div");
      left.appendChild(h("span", "name", b.name));
      const right = h("div");
      const btn = h("button", "btn sp-btn", "Launch");
      const status = h("div", "sp-status");
      right.append(btn, status);
      const sub = h("div", "sub");
      const pb = bar();
      row.append(left, right, sub, pb);
      sec.appendChild(row);
      this.bodyRows.set(b.id, row);
      btn.onclick = () => {
        if (canLaunch(this.m, b.id)) this.hooks.launch(b.id);
      };
      const travel = fmtDuration(b.travelDays * 86400000);
      const inner = b.id === "moon" || b.id === "mercury" || b.id === "mars" || b.id === "venus";
      this.updaters.push(() => {
        const m = this.m;
        this.reveal(row, inner || !!m.claimed.moon);
        const st = bodyStatus(m, b.id);
        toggle(row, "locked", st === "locked");
        toggle(row, "claimed", st === "claimed");
        const auto = b.auto && m.research.selfrep && st === "available";
        setHtml(
          sub,
          st === "claimed"
            ? `<span class="gold">${b.reward}</span>`
            : `${b.probes} probe${b.probes > 1 ? "s" : ""} · ${travel} · ${b.reward}${auto ? " · <span class='ai'>auto</span>" : ""}`,
        );
        const mission = m.missions.find((x) => x.body === b.id);
        show(pb, !!mission);
        if (mission) setBar(pb, (m.worldMs - mission.start) / mission.dur);
        if (st === "available") {
          show(btn, true);
          show(status, false);
          btn.disabled = !canLaunch(m, b.id);
          const need = b.probes - m.probes;
          setText(btn, need > 0 ? `Need ${need} more` : m.missions.length >= m.b.launch ? "No free pad" : "Launch");
        } else {
          show(btn, false);
          show(status, true);
          status.className = `sp-status ${st}`;
          if (st === "claimed") setText(status, "✓ claimed");
          else if (st === "enroute" && mission) {
            const left = Math.max(0, mission.dur - (m.worldMs - mission.start));
            setText(status, `en route · ${fmtDuration(left)}`);
          } else setText(status, "—");
        }
      });
    }
  }

  // ---------- Dyson swarm ----------

  private buildDyson(): void {
    const { sec } = this.section("DYSON SWARM");
    const note = h("div", "sp-note");
    sec.appendChild(note);
    this.updaters.push(() => this.reveal(sec, !!this.m.claimed.mercury));
    const big = h("div", "sp-big");
    const pct = h("span");
    big.append(pct, h("small", "", "of the Sun enclosed"));
    sec.appendChild(big);
    const cov = bar("gold big");
    sec.appendChild(cov);
    const kv = h("div", "sp-kv");
    const row = (k: string) => {
      kv.appendChild(h("div", "k", k));
      const v = h("div", "v");
      kv.appendChild(v);
      return v;
    };
    const captured = row("Captured");
    const collectors = row("Collectors");
    const mercury = row("Mercury remaining");
    sec.appendChild(kv);

    const frow = h("div", "sp-row");
    frow.style.marginTop = "8px";
    const fleft = h("div");
    fleft.appendChild(h("span", "name", BUILDING.foundry.name));
    const fcount = h("span", "count");
    fleft.appendChild(fcount);
    const fbtn = h("button", "btn sp-btn");
    const fsub = h("div", "sub");
    frow.append(fleft, fbtn, fsub);
    sec.appendChild(frow);
    fbtn.onclick = () => {
      const n = this.buyMode === "max" ? maxAffordable(this.m, "foundry") : this.buyCount("foundry");
      if (n > 0) {
        this.hooks.build("foundry", n);
        this.flash(frow);
      }
    };

    this.updaters.push((d) => {
      const m = this.m;
      const unlocked = isUnlocked(m, "foundry");
      show(note, !unlocked);
      setText(
        note,
        !m.claimed.mercury ? "Requires Mercury: 3.3 × 10²³ kg of accessible metal." : "Requires Planetary disassembly.",
      );
      const c = m.coverage;
      setText(pct, c <= 0 ? "0%" : c < 0.001 ? `${(c * 100).toFixed(4)}%` : c < 0.1 ? `${(c * 100).toFixed(2)}%` : `${(c * 100).toFixed(1)}%`);
      setBar(cov, c);
      setText(captured, `${fmtW(c * SUN_W)}`);
      setText(collectors, fmtShort(c * 2.4e13));
      setText(mercury, `${((1 - c) * 100).toFixed(c > 0.999 ? 2 : 1)}%`);
      toggle(frow, "locked", !unlocked);
      setText(fcount, `×${m.b.foundry}`);
      setText(
        fsub,
        m.research.selfassembly
          ? `+${(d.coverageRate * 100).toPrecision(2)}%/s coverage (collectors replicating)`
          : unlocked
            ? "Converts Mercury into collectors. Self-assembly research makes growth exponential."
            : "Planet → Dyson collectors",
      );
      if (!unlocked) {
        setText(fbtn, "Locked");
        fbtn.disabled = true;
      } else {
        const n = this.buyMode === "max" ? maxAffordable(m, "foundry") : this.buyCount("foundry");
        const cost = buildCost(m, "foundry", Math.max(1, n));
        setText(fbtn, `${n > 1 ? `+${n}` : "Build"} · ${fmtT(cost)}`);
        fbtn.disabled = n < 1;
      }
    });
  }
}
