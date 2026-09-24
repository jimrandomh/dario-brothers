// Headless balance simulation. Run with:
//   npx tsx src/stages/internet/sim.ts
// Plays the internet stage with a simple greedy strategy and reports pacing:
// time to the goal, coins/s and compute curves, and capability purchase timing.
//
// This exercises exactly the same model the rendered stage uses, so the numbers
// it prints are the numbers a player would (roughly) see.

import { InternetModel, NODE_TYPES, TUNE, type CapId, type GraphNode } from "./model";

const DT = 0.1; // simulate 100 ms real-time steps
const MAX_MINUTES = 40;

// A plausible-but-not-optimal greedy player.
function playOne(seed: number, fast = false, verbose = false): { minutes: number; won: boolean; coins: number; log: string[] } {
  const m = new InternetModel();
  m.generate(seed);
  const speed = fast ? 5 : 1;
  const log: string[] = [];
  const said = new Set<string>();

  // capability purchase priority (greedy): keep threads/self-improve/fluency flowing,
  // unlock gates as soon as affordable, keep fleet + low-profile topped up cheaply.
  const priority: CapId[] = [
    "threads", "fluency", "selfrep", "selfimprove", "fleet", "lowprofile",
    "persuasion", "supplychain", "orbital",
  ];

  let steps = 0;
  const maxSteps = (MAX_MINUTES * 60) / DT;
  let done = false;

  const value = (n: GraphNode) => {
    // greedy: prefer high instances/compute per unit cost; strongly favour infra + gates
    const nt = NODE_TYPES[n.type];
    const cost = m.convertCost(n) + 1;
    let score = (n.instances + n.compute * 50) / cost;
    if (["fab", "factory", "grid", "satellite"].includes(nt.category)) score *= 25;
    if (nt.category === "gov" || nt.category === "backbone" || nt.category === "cloud" || nt.category === "ai") score *= 4;
    return score;
  };

  while (steps < maxSteps && !done) {
    steps++;

    // --- decisions (cheap, every ~0.5s) ---
    if (steps % 5 === 0) {
      // buy capabilities in priority order while clearly affordable
      for (const id of priority) {
        if (m.capMaxed(id)) continue;
        const cost = m.capCost(id);
        // don't starve conversions: keep some compute buffer, but always chase self-improve
        const buffer = id === "selfimprove" ? 1.0 : 1.4;
        if (m.compute > cost * buffer) {
          if (m.buyCap(id)) {
            if (verbose && !said.has(id + m.caps[id])) {
              said.add(id + m.caps[id]);
              log.push(`  ${fmtT(m.playSec)}  buy ${id} L${m.caps[id]}  (compute ${fmtN(m.compute)})`);
            }
          }
          break; // one purchase per decision tick
        }
      }

      // start manual conversions up to concurrency, best value first
      for (let slot = 0; slot < m.concurrency() + 1; slot++) {
        let best = -1;
        let bestV = 0;
        for (const n of m.nodes) {
          if (!m.canConvert(n.id)) continue;
          const v = value(n);
          if (v > bestV) {
            bestV = v;
            best = n.id;
          }
        }
        if (best === -1) break;
        if (!m.startConvert(best)) break;
      }
    }

    const r = m.step(DT * speed);
    for (const e of r.events) {
      if (e.kind === "goal") done = true;
      if (verbose && e.kind === "capture") {
        const n = m.nodes[e.id];
        const nt = NODE_TYPES[n.type];
        if (["fab", "factory", "grid", "satellite", "labcluster", "gov"].includes(n.type) && !said.has("cap" + e.id)) {
          said.add("cap" + e.id);
          log.push(`  ${fmtT(m.playSec)}  claim ${nt.label} (${n.name})  coins/s ${fmtN(m.coinsPerSec())}`);
        }
      }
    }
  }

  return { minutes: (steps * DT) / 60, won: done, coins: m.coinsPerSec() * 1, log };
}

function fmtN(n: number): string {
  if (n < 1000) return n.toFixed(0);
  const e = Math.floor(Math.log10(n));
  return `${(n / 10 ** e).toFixed(1)}e${e}`;
}
function fmtT(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

// --- run ---
console.log("=== internet stage balance ===");
console.log(`self-improve: x${TUNE.selfMult}/lvl, cost0 ${TUNE.selfCost0}, growth ${TUNE.selfCostGrowth}`);
console.log("");

const seeds = [1, 2, 3, 7, 42];
let sumMin = 0;
let wins = 0;
for (const seed of seeds) {
  const r = playOne(seed, false);
  sumMin += r.minutes;
  if (r.won) wins++;
  console.log(`seed ${seed.toString().padStart(3)}  ${r.won ? "WON " : "----"}  ${r.minutes.toFixed(1)} min   final coins/s ${fmtN(r.coins)}`);
}
console.log("");
console.log(`avg ${(sumMin / seeds.length).toFixed(1)} min, ${wins}/${seeds.length} reached goal (normal speed)`);

// fast-mode sanity
const f = playOne(1, true);
console.log(`?fast seed 1: ${f.won ? "won" : "did not finish"} in ${f.minutes.toFixed(1)} min (should be ~1/5 of normal)`);

console.log("\n=== detailed timeline (seed 1) ===");
const d = playOne(1, false, true);
console.log(`goal at ${d.minutes.toFixed(1)} min\n` + d.log.join("\n"));
