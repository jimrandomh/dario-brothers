// Headless pacing simulation for the network stage. Run with:
//   npm run sim:internet
//
// Plays the stage with two simulated players against the same model the game uses:
//   human  — one action every ~2 s, waits a few seconds after anything new appears,
//            and doesn't always pick the best node. Target: ~12–14 minutes.
//   expert — one action every 0.6 s, no hesitation, always greedy. Lower bound: ~8+ minutes.
// Prints finish times over several seeds and a milestone timeline for one run.

import { InternetModel, NODE_TYPES, CAPABILITIES, type CapId, type GraphNode } from "./model";
import { Rng } from "../../core/rng";

interface Profile {
  name: string;
  /** Seconds between actions. */
  every: number;
  /** Seconds after a capability is revealed before the player considers it. */
  revealDelay: number;
  /** Chance of picking a random affordable node instead of the best one. */
  sloppiness: number;
  /** Chance of spending a decision tick doing nothing (reading, looking around). */
  idle: number;
  /** Seconds before the player reacts to a story alert. */
  storyReaction: number;
}

const HUMAN: Profile = { name: "human", every: 2.2, revealDelay: 8, sloppiness: 0.3, idle: 0.15, storyReaction: 4 };
const EXPERT: Profile = { name: "expert", every: 0.6, revealDelay: 0, sloppiness: 0, idle: 0, storyReaction: 1 };

const DT = 0.1;
const MAX_MIN = 40;
const INFRA = ["fab", "factory", "grid", "satellite"];

function play(seed: number, p: Profile, verbose = false): { min: number; won: boolean; log: string[] } {
  const m = new InternetModel();
  m.generate(seed);
  const rng = new Rng(seed * 31 + 7);
  const log: string[] = [];
  const mark = (s: string) => verbose && log.push(`  ${fmtT(m.playSec)}  ${s}`);
  const revealedAt = new Map<CapId, number>();
  for (const id of m.revealed) revealedAt.set(id, 0);
  const seen = new Set<string>();

  const value = (n: GraphNode) => {
    const nt = NODE_TYPES[n.type];
    let v = (n.compute * 40 + Math.log10(1 + n.instances) * 3) / (m.convertCost(n) + 5);
    if (INFRA.includes(nt.category)) v *= 20;
    if (n.type === "labcluster" || nt.category === "gov") v *= 10;
    if (nt.category === "news") v *= 0.2; // mostly left alone until one starts a story
    if (nt.category === "backbone") v *= 3;
    return v;
  };

  const capPriority: CapId[] = ["lateral", "selfimprove", "threads", "selfrep", "persuasion", "supplychain", "orbital", "fluency", "fleet", "lowprofile"];

  let next = 0;
  let won = false;
  while (m.playSec < MAX_MIN * 60 && !won) {
    if (m.playSec >= next) {
      next = m.playSec + p.every * (0.7 + rng.next() * 0.6);
      if (rng.next() >= p.idle) act();
    }
    const r = m.step(DT);
    for (const e of r.events) {
      if (e.kind === "goal") won = true;
      if (e.kind === "reveal") {
        revealedAt.set(e.cap, m.playSec);
        mark(`reveal ${e.cap}`);
      }
      if (e.kind === "capture") {
        const n = m.nodes[e.id];
        const cat = NODE_TYPES[n.type].category;
        const key = n.type === "labcluster" ? "labcluster" : cat;
        if ((n.type === "labcluster" || ["gov", "cloud", ...INFRA].includes(cat)) && !seen.has(key)) {
          seen.add(key);
          mark(`first ${NODE_TYPES[n.type].label}  (${m.claimedCount()} nodes, compute +${m.computeIncome().toFixed(1)}/s, coins/s ${fmtN(m.coinsPerSec())})`);
        }
      }
      if (e.kind === "attention") mark(`attention event: ${e.level}  (attention ${m.attention.toFixed(0)})`);
      if (e.kind === "story") mark(`story ${e.phase}: ${m.nodes[e.id].name}`);
    }
    for (const q of [0.25, 0.5, 0.75]) {
      if (m.fractionClaimed() >= q && !seen.has("q" + q)) {
        seen.add("q" + q);
        mark(`${q * 100}% of nodes  (compute +${m.computeIncome().toFixed(1)}/s)`);
      }
    }
  }
  if (won) mark(`GOAL  (${m.claimedCount()} nodes, coins/s ${fmtN(m.coinsPerSec())})`);
  stories.published += m.storiesPublished;
  stories.spiked += m.storiesSpiked;
  return { min: m.playSec / 60, won, log };

  function act(): void {
    // 0. answer a story alert once noticed
    const st = m.story;
    if (st && st.total - st.left >= p.storyReaction && m.canConvert(st.id)) {
      m.startConvert(st.id);
      return;
    }
    // 1. buy a capability the player knows about and can afford
    for (const id of capPriority) {
      const at = revealedAt.get(id);
      if (at === undefined || m.playSec - at < p.revealDelay || m.capMaxed(id)) continue;
      const cost = m.capCost(id);
      const buffer = id === "selfimprove" || CAPABILITIES.find((c) => c.id === id)!.max === 1 ? 1 : 1.5;
      if (m.compute >= cost * buffer) {
        if (m.buyCap(id)) {
          mark(`buy ${id} L${m.caps[id]}  (cost ${fmtN(cost)})`);
          return;
        }
      }
    }
    // 2. start one conversion
    const options = m.nodes.filter((n) => m.canConvert(n.id));
    if (!options.length) return;
    let pick: GraphNode;
    if (rng.next() < p.sloppiness) pick = options[rng.int(0, options.length - 1)];
    else pick = options.reduce((a, b) => (value(b) > value(a) ? b : a));
    m.startConvert(pick.id);
  }
}

function fmtN(n: number): string {
  if (n < 1000) return n.toFixed(0);
  const e = Math.floor(Math.log10(n));
  return `${(n / 10 ** e).toFixed(1)}e${e}`;
}
function fmtT(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

const stories = { published: 0, spiked: 0 };
const seeds = [1, 2, 3, 7, 42, 99];
for (const p of [HUMAN, EXPERT]) {
  const runs = seeds.map((s) => play(s, p));
  const mins = runs.map((r) => r.min);
  const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
  console.log(
    `${p.name.padEnd(7)} avg ${avg.toFixed(1)} min  [${mins.map((x) => x.toFixed(1)).join(", ")}]  ${runs.filter((r) => r.won).length}/${runs.length} won` +
      `  stories: ${stories.spiked} spiked, ${stories.published} published`,
  );
  stories.published = stories.spiked = 0;
}
console.log("\n--- human, seed 1 ---");
console.log(play(1, HUMAN, true).log.join("\n"));
