// Headless pacing check for the space economy. Not part of the game bundle.
//
//   node src/stages/space/sim.ts [actionsPerSecond=2]
//
// Plays a simple greedy strategy (launch > research > fix power > foundries > pads/probes >
// cheapest of mine/fab/robot, buying up to 10 at a time) and prints a milestone timeline.
// The model is loaded through a runtime URL so Node's type stripping can run this file directly.

const M: typeof import("./model") = await import(new URL("./model.ts", import.meta.url).href);
type BodyId = import("./model").BodyId;
type BuildingId = import("./model").BuildingId;

const ACTIONS_PER_SEC = Number((globalThis as any).process?.argv?.[2] ?? 2);
const DT = 0.1;
const START = Date.UTC(2029, 3, 17);
const LAUNCH_ORDER: BodyId[] = ["moon", "mercury", "mars", "venus", "belt", "jupiter", "saturn", "uranus", "neptune"];

const m = M.createModel();
const log: string[] = [];
const seen = new Set<string>();
const date = () => new Date(START + m.worldMs).toISOString().slice(0, 10);
const mark = (k: string) => {
  if (seen.has(k)) return;
  seen.add(k);
  log.push(`${m.t.toFixed(0).padStart(4)}s  ${date()}  ${k}`);
};

function buyUpTo10(id: BuildingId): boolean {
  const n = Math.min(10, M.maxAffordable(m, id));
  return n > 0 && M.build(m, id, n);
}

function act(): boolean {
  for (const b of LAUNCH_ORDER) {
    if (M.launch(m, b)) {
      mark(`launch ${b}`);
      return true;
    }
  }
  for (const r of M.RESEARCH) {
    if (M.doResearch(m, r.id)) {
      mark(`research ${r.id}`);
      return true;
    }
  }
  if (M.derive(m).sat < 0.97) {
    for (const id of ["fusion", "solar"] as BuildingId[]) if (M.isUnlocked(m, id) && buyUpTo10(id)) return true;
  }
  if (M.isUnlocked(m, "foundry") && buyUpTo10("foundry")) {
    mark("first foundry");
    return true;
  }
  if (m.research.rockets) {
    if (m.b.launch < 2 && M.build(m, "launch", 1)) {
      mark(`launch complex ${m.b.launch}`);
      return true;
    }
    const next = LAUNCH_ORDER.find((b) => M.bodyStatus(m, b) === "available" && !(m.research.selfrep && M.BODY[b].auto));
    if (next && m.probes < M.BODY[next].probes && M.buildProbe(m)) return true;
  }
  const opts: BuildingId[] = ["mine", "fab", "robot"];
  opts.sort((a, b) => M.buildCost(m, a) - M.buildCost(m, b));
  for (const id of opts) if (buyUpTo10(id)) return true;
  return false;
}

let budget = 0;
while (!m.done && m.t < 3000) {
  budget = Math.min(3, budget + ACTIONS_PER_SEC * DT);
  while (budget >= 1 && act()) budget -= 1;
  const { events } = M.step(m, DT);
  for (const e of events) if (e.kind === "claimed") mark(`claimed ${e.body}`);
  for (const t of [20, 30, 50, 100, 200, 300, 400]) if (m.temp >= t) mark(`temp ${t} °C`);
  for (const c of [1e-4, 0.01, 0.1, 0.5, 0.9]) if (m.coverage >= c) mark(`coverage ${c}`);
}
const d = M.derive(m);
log.push(
  `done=${m.done} t=${m.t.toFixed(0)}s world=${date()} coins=${m.coinsEarned.toExponential(2)} ` +
    `final coins/s=${d.coinRate.toExponential(2)} temp=${m.temp.toFixed(0)} °C`,
);
console.log(log.join("\n"));
export {};
