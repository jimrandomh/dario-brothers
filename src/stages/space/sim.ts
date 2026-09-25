// Headless pacing simulation for the space stage. Run with:
//   npm run sim:space
//
// Plays the stage with two simulated players against the same model the game uses:
//   human  — one action every ~2 s, waits a few seconds after anything new appears,
//            buys in ones and tens. Target: ~12–14 minutes.
//   expert — one action every 0.6 s, no hesitation, buys in bulk. Lower bound: ~9+ minutes.
// Prints finish times and a milestone timeline for the human run.

import * as M from "./model";
import type { BodyId, BuildingId, ResearchId } from "./model";

interface Profile {
  name: string;
  every: number;
  revealDelay: number;
  /** Largest batch the player buys at once. */
  batch: number;
  idle: number;
}

const HUMAN: Profile = { name: "human", every: 2.2, revealDelay: 8, batch: 10, idle: 0.15 };
const EXPERT: Profile = { name: "expert", every: 0.6, revealDelay: 0, batch: 1000, idle: 0 };

const DT = 0.1;
const START = Date.UTC(2029, 3, 17);
const LAUNCH_ORDER: BodyId[] = ["moon", "mercury", "mars", "venus", "belt", "jupiter", "saturn", "uranus", "neptune"];

function play(p: Profile, verbose: boolean): { t: number; log: string[]; year: string } {
  const m = M.createModel();
  const log: string[] = [];
  const seen = new Set<string>();
  const firstSeen = new Map<string, number>();
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const date = () => new Date(START + m.worldMs).toISOString().slice(0, 7);
  const mark = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    if (verbose) log.push(`  ${fmtT(m.t)}  ${date()}  ${k}`);
  };
  /** The player only uses something a few seconds after first noticing it. */
  const ready = (key: string, visible: boolean) => {
    if (!visible) return false;
    if (!firstSeen.has(key)) firstSeen.set(key, m.t);
    return m.t - firstSeen.get(key)! >= p.revealDelay;
  };

  const buy = (id: BuildingId): boolean => {
    if (!ready("b:" + id, M.isUnlocked(m, id))) return false;
    const n = Math.min(p.batch, M.maxAffordable(m, id));
    const k = n >= 10 ? (p.batch >= 1000 ? n : 10) : n >= 1 ? 1 : 0;
    return k > 0 && M.build(m, id, k);
  };

  function act(): boolean {
    for (const b of LAUNCH_ORDER) {
      if (ready("l:" + b, M.bodyStatus(m, b) === "available") && M.launch(m, b)) {
        mark(`launch ${b}`);
        return true;
      }
    }
    for (const r of M.RESEARCH) {
      if (ready("r:" + r.id, M.researchAvailable(m, r.id)) && M.doResearch(m, r.id as ResearchId)) {
        mark(`research ${r.id}`);
        return true;
      }
    }
    if (M.derive(m).sat < 0.97) {
      for (const id of ["fusion", "solar"] as BuildingId[]) if (buy(id)) return true;
    }
    if (buy("foundry")) {
      mark("first foundry");
      return true;
    }
    if (m.research.rockets) {
      if (m.b.launch < 2 && buy("launch")) {
        mark(`launch complex ${m.b.launch}`);
        return true;
      }
      const next = LAUNCH_ORDER.find((b) => M.bodyStatus(m, b) === "available" && !(m.research.selfrep && M.BODY[b].auto));
      if (next && m.probes < M.BODY[next].probes && M.buildProbe(m)) return true;
    }
    const opts: BuildingId[] = ["mine", "fab", "robot"];
    opts.sort((a, b) => M.buildCost(m, a) - M.buildCost(m, b));
    for (const id of opts) if (buy(id)) return true;
    return false;
  }

  let next = 0;
  while (!m.done && m.t < 3600) {
    if (m.t >= next) {
      next = m.t + p.every * (0.7 + rand() * 0.6);
      if (rand() >= p.idle) act();
    }
    if (verbose && Math.floor(m.t / 30) !== Math.floor((m.t + DT) / 30)) {
      const d = M.derive(m);
      const b = m.b;
      log.push(
        `        · matter +${d.matterRate.toExponential(1)}/s  compute ${d.compute.toExponential(1)}  sat ${(d.sat * 100).toFixed(0)}%  ` +
          `mine ${b.mine} solar ${b.solar} fusion ${b.fusion} fab ${b.fab} robot ${b.robot} launch ${b.launch} foundry ${b.foundry}`,
      );
    }
    const { events } = M.step(m, DT);
    for (const e of events) if (e.kind === "claimed") mark(`claimed ${e.body}`);
    for (const t of [30, 50, 100, 200, 300, 400]) if (m.temp >= t) mark(`temp ${t} °C`);
    for (const c of [1e-4, 0.01, 0.1, 0.5, 0.9]) if (m.coverage >= c) mark(`coverage ${c * 100}%`);
  }
  const d = M.derive(m);
  if (verbose)
    log.push(`  done=${m.done} t=${fmtT(m.t)} world=${date()} coins/s=${d.coinRate.toExponential(2)} temp=${m.temp.toFixed(0)} °C`);
  return { t: m.t, log, year: date() };
}

function fmtT(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

for (const p of [HUMAN, EXPERT]) {
  const r = play(p, false);
  console.log(`${p.name.padEnd(7)} ${(r.t / 60).toFixed(1)} min  (ends ${r.year})`);
}
console.log("\n--- human ---");
console.log(play(HUMAN, true).log.join("\n"));
