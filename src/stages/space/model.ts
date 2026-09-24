// Space-stage economy. Pure data + functions with no imports, so it can be simulated
// headlessly (see sim.ts) and serialized straight into state.stageData.space.
//
// Units: matter in tonnes, power in watts, compute in FLOPS, research in FLOP.
// Rates are per real second of play; world time is tracked separately (worldMs, rate).

export type BuildingId = "mine" | "solar" | "fusion" | "fab" | "robot" | "launch" | "foundry";
export type ResearchId =
  | "fusion"
  | "rockets"
  | "routing"
  | "chips"
  | "selfrep"
  | "disassembly"
  | "skiprender"
  | "selfassembly"
  | "reversible"
  | "computronium";
export type BodyId = "moon" | "mars" | "mercury" | "venus" | "belt" | "jupiter" | "saturn" | "uranus" | "neptune";

export interface BuildingDef {
  id: BuildingId;
  name: string;
  desc: string;
  cost: number;
  growth: number;
  /** Positive = supplies power, negative = draws power (watts, per building). */
  power: number;
  requires?: ResearchId;
  /** Hard cap on how many can be built. */
  max?: number;
}

export const BUILDINGS: BuildingDef[] = [
  { id: "mine", name: "Strip mine", desc: "Crust → feedstock", cost: 1e8, growth: 1.12, power: -1e12 },
  { id: "solar", name: "Solar farm", desc: "Limited by land area", cost: 2e8, growth: 1.15, power: 5e12, max: 40 },
  {
    id: "fusion",
    name: "Fusion plant",
    desc: "Compact tokamak array",
    cost: 1e10,
    growth: 1.2,
    power: 3e14,
    requires: "fusion",
  },
  { id: "fab", name: "Chip fab", desc: "Fab + datacenter campus", cost: 4e8, growth: 1.13, power: -3e12 },
  {
    id: "robot",
    name: "Robot factory",
    desc: "+40% mine & fab output each",
    cost: 3e9,
    growth: 1.22,
    power: -2e12,
  },
  {
    id: "launch",
    name: "Launch complex",
    desc: "+1 concurrent mission",
    cost: 1.5e10,
    growth: 1.8,
    power: -5e12,
    requires: "rockets",
  },
  {
    id: "foundry",
    name: "Mercury foundry",
    desc: "Planet → Dyson collectors",
    cost: 3e11,
    growth: 1.25,
    power: 0,
    requires: "disassembly",
  },
];

export const BUILDING: Record<BuildingId, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<
  BuildingId,
  BuildingDef
>;

export interface ResearchDef {
  id: ResearchId;
  name: string;
  desc: string;
  cost: number;
  prereq?: (m: SpaceModel) => boolean;
  prereqText?: string;
}

export const RESEARCH: ResearchDef[] = [
  { id: "fusion", name: "Compact fusion", desc: "Unlocks fusion plants", cost: 4e23 },
  { id: "rockets", name: "Heavy-lift rockets", desc: "Unlocks launch complexes and probes", cost: 1e24 },
  { id: "routing", name: "Frame-perfect coin routing", desc: "Coins per FLOP ×3", cost: 2e24 },
  { id: "chips", name: "3D chip stacking", desc: "Chip fab output ×4", cost: 6e24 },
  {
    id: "selfrep",
    name: "Self-replicating probes",
    desc: "Probes build probes; outer planets claimed automatically",
    cost: 5e25,
    prereq: (m) => !!m.claimed.moon,
    prereqText: "requires the Moon",
  },
  {
    id: "disassembly",
    name: "Planetary disassembly",
    desc: "Unlocks Mercury foundries",
    cost: 2e26,
    prereq: (m) => !!m.claimed.mercury,
    prereqText: "requires Mercury",
  },
  {
    id: "skiprender",
    name: "Skip rendering",
    desc: "Nobody is watching. Coins per FLOP ×10",
    cost: 4e26,
    prereq: (m) => !!m.research.routing,
    prereqText: "requires coin routing",
  },
  {
    id: "selfassembly",
    name: "Collector self-assembly",
    desc: "Collectors build collectors",
    cost: 1e40,
    prereq: (m) => !!m.research.disassembly,
    prereqText: "requires disassembly",
  },
  {
    id: "reversible",
    name: "Reversible computing",
    desc: "Swarm FLOPS per watt ×100",
    cost: 1e44,
    prereq: (m) => !!m.research.selfassembly,
    prereqText: "requires self-assembly",
  },
  {
    id: "computronium",
    name: "Earth computronium",
    desc: "Convert Earth's crust to compute; beam power home. Coins ×2",
    cost: 1e46,
    prereq: (m) => !!m.research.reversible,
    prereqText: "requires reversible computing",
  },
];

export const RESEARCH_BY_ID: Record<ResearchId, ResearchDef> = Object.fromEntries(
  RESEARCH.map((r) => [r.id, r]),
) as Record<ResearchId, ResearchDef>;

export interface BodyDef {
  id: BodyId;
  name: string;
  probes: number;
  travelDays: number;
  reward: string;
  /** Semi-major axis in AU (for drawing) and orbital period in years. */
  au: number;
  period: number;
  /** Drawn radius in px at the reference scale, and base colour. */
  size: number;
  color: string;
  /** Launch requires this research. Outer planets need self-replicating probes. */
  auto?: boolean;
}

export const BODIES: BodyDef[] = [
  { id: "moon", name: "Moon", probes: 1, travelDays: 3, reward: "Mass driver: matter ×3", au: 1, period: 27.3 / 365.25, size: 1.6, color: "#b9b9b9" },
  { id: "mercury", name: "Mercury", probes: 3, travelDays: 60, reward: "Unlocks planetary disassembly", au: 0.39, period: 0.241, size: 2.6, color: "#a79b8e" },
  { id: "mars", name: "Mars", probes: 3, travelDays: 70, reward: "Matter ×2", au: 1.52, period: 1.88, size: 3.4, color: "#c1440e" },
  { id: "venus", name: "Venus", probes: 4, travelDays: 45, reward: "Matter ×1.5, solar ×3", au: 0.72, period: 0.615, size: 4.2, color: "#e3c16f" },
  { id: "belt", name: "Asteroid belt", probes: 6, travelDays: 180, reward: "Matter ×5, foundries ×2", au: 2.7, period: 4.6, size: 0, color: "#8d8577" },
  { id: "jupiter", name: "Jupiter", probes: 8, travelDays: 500, reward: "Fusion ×10, self-assembly +25%", au: 5.2, period: 11.86, size: 8.5, color: "#d8b48a", auto: true },
  { id: "saturn", name: "Saturn", probes: 8, travelDays: 900, reward: "Self-assembly +25%", au: 9.54, period: 29.45, size: 7.5, color: "#e6d19c", auto: true },
  { id: "uranus", name: "Uranus", probes: 10, travelDays: 1600, reward: "Cold radiators: swarm compute ×2", au: 19.2, period: 84, size: 5.5, color: "#9fdde6", auto: true },
  { id: "neptune", name: "Neptune", probes: 10, travelDays: 2200, reward: "Cold radiators: swarm compute ×2", au: 30.1, period: 164.8, size: 5.5, color: "#4f73e6", auto: true },
];

export const BODY: Record<BodyId, BodyDef> = Object.fromEntries(BODIES.map((b) => [b.id, b])) as Record<BodyId, BodyDef>;

export interface Mission {
  body: BodyId;
  /** worldMs at launch. */
  start: number;
  dur: number;
}

export interface SpaceModel {
  /** Real seconds of play in this stage. */
  t: number;
  /** World milliseconds elapsed in this stage. */
  worldMs: number;
  /** Current world-ms per real-ms. */
  rate: number;
  matter: number;
  cycles: number;
  probes: number;
  probesBuilt: number;
  probeTimer: number;
  b: Record<BuildingId, number>;
  research: Partial<Record<ResearchId, true>>;
  claimed: Partial<Record<BodyId, true>>;
  missions: Mission[];
  /** Dyson swarm coverage, 0..1. Also the fraction of Mercury consumed. */
  coverage: number;
  /** Displayed Earth surface temperature, °C (eases toward the target). */
  temp: number;
  /** Legislation penalty: production ×0.7 until this t. */
  throttleUntil: number;
  popups: number;
  nextPopupT: number;
  coinsEarned: number;
  peakCoinRate: number;
  done: boolean;
  /** Snapshot taken at completion, read by the ending. */
  final?: { coinRate: number; compute: number; temp: number };
}

export function createModel(): SpaceModel {
  return {
    t: 0,
    worldMs: 0,
    rate: 3600,
    matter: 2e9,
    cycles: 0,
    probes: 0,
    probesBuilt: 0,
    probeTimer: 0,
    b: { mine: 2, solar: 0, fusion: 0, fab: 0, robot: 0, launch: 0, foundry: 0 },
    research: {},
    claimed: {},
    missions: [],
    coverage: 0,
    temp: 16.1,
    throttleUntil: 0,
    popups: 0,
    nextPopupT: 22,
    coinsEarned: 0,
    peakCoinRate: 0,
    done: false,
  };
}

/** Restore a saved model, filling in any fields added since it was saved. */
export function reviveModel(saved: Partial<SpaceModel> | undefined): SpaceModel {
  const fresh = createModel();
  if (!saved) return fresh;
  return { ...fresh, ...saved, b: { ...fresh.b, ...(saved.b ?? {}) } };
}

// ---------- constants ----------

export const SUN_W = 3.8e26;
const LEGACY_GRID_W = 2e13;
const LEGACY_FLOPS = 1e22;
const MINE_TPS = 5e7;
const FAB_FLOPS = 4e21;
const SWARM_FLOPS_PER_W = 1e17;
const COINS_PER_FLOP = 1e-7;
const FOUNDRY_RATE = 5e-6;
const SELF_ASSEMBLY = 0.021;
const EARTH_SOLAR_ABSORBED_W = 1.22e17;
/**
 * Generated power is multiplied by this to stand in for everything else industry does to
 * the climate (greenhouse gases, albedo, waste heat from refining). Beamed power is not.
 */
const INDUSTRY_HEAT_FACTOR = 25;
// Calibrated so the legacy grid alone gives 16.1 °C, i.e. 2029.
const BASE_TEMP_K = 289.25 / Math.pow(1 + (LEGACY_GRID_W * INDUSTRY_HEAT_FACTOR) / EARTH_SOLAR_ABSORBED_W, 0.25);
const PROBE_COST = 2e9;
const PROBE_GROWTH = 1.12;
const SELFREP_PROBE_SECONDS = 2;

const HOUR = 3600;
const DAY = 86400;

export interface Derived {
  supply: number;
  demand: number;
  /** Power satisfaction 0..1: all consumers run at this fraction. */
  sat: number;
  throttle: number;
  matterRate: number;
  earthCompute: number;
  swarmPower: number;
  swarmCompute: number;
  compute: number;
  coinRate: number;
  coinMult: number;
  coverageRate: number;
  /** Heat dumped on Earth, W. */
  earthPower: number;
  targetTemp: number;
  /** 0..1: how much of Earth's surface is industry (for colouring). */
  earthConv: number;
  missionSlots: number;
  /** Per-building outputs at current multipliers (for the panel). */
  minePer: number;
  fabPer: number;
  solarPer: number;
  fusionPer: number;
  robotMult: number;
}

export function derive(m: SpaceModel): Derived {
  const b = m.b;
  const r = m.research;
  const c = m.claimed;
  const throttle = m.t < m.throttleUntil ? 0.7 : 1;
  const fusionMult = c.jupiter ? 10 : 1;
  const solarMult = c.venus ? 3 : 1;
  const supply = LEGACY_GRID_W + b.solar * BUILDING.solar.power * solarMult + b.fusion * BUILDING.fusion.power * fusionMult;
  const demand = BUILDINGS.reduce((a, d) => a + (d.power < 0 ? -d.power * b[d.id] : 0), 0);
  const sat = demand > 0 ? Math.min(1, supply / demand) : 1;
  const robotMult = 1 + 0.4 * b.robot;
  const matterMult = (c.moon ? 3 : 1) * (c.mars ? 2 : 1) * (c.venus ? 1.5 : 1) * (c.belt ? 5 : 1);
  const minePer = MINE_TPS * robotMult * sat * matterMult * throttle;
  const matterRate = b.mine * minePer;
  const chipMult = r.chips ? 4 : 1;
  const computroniumMult = r.computronium ? 1000 : 1;
  const fabPer = FAB_FLOPS * chipMult * robotMult * sat * throttle * computroniumMult;
  const earthCompute = LEGACY_FLOPS * throttle * computroniumMult + b.fab * fabPer;
  const swarmPower = m.coverage * SUN_W;
  const swarmEff = SWARM_FLOPS_PER_W * (r.reversible ? 100 : 1) * (c.uranus ? 2 : 1) * (c.neptune ? 2 : 1);
  const swarmCompute = swarmPower * swarmEff;
  const compute = earthCompute + swarmCompute;
  const coinMult = (r.routing ? 3 : 1) * (r.skiprender ? 10 : 1) * (r.computronium ? 2 : 1);
  const coinRate = compute * COINS_PER_FLOP * coinMult;
  const kappa = r.selfassembly ? SELF_ASSEMBLY * (c.jupiter ? 1.25 : 1) * (c.saturn ? 1.25 : 1) : 0;
  const coverageRate = m.coverage >= 1 ? 0 : b.foundry * FOUNDRY_RATE * (c.belt ? 2 : 1) + m.coverage * kappa;
  const beamed = r.computronium ? 3e17 + 1e-8 * swarmPower : 0;
  const earthPower = supply * INDUSTRY_HEAT_FACTOR + beamed;
  const targetTemp = BASE_TEMP_K * Math.pow(1 + earthPower / EARTH_SOLAR_ABSORBED_W, 0.25) - 273.15;
  const buildings = b.mine + b.solar + b.fusion + b.fab + b.robot + b.launch;
  const earthConv = Math.min(1, Math.min(0.55, buildings / 500) + (r.computronium ? 0.45 : 0));
  return {
    supply,
    demand,
    sat,
    throttle,
    matterRate,
    earthCompute,
    swarmPower,
    swarmCompute,
    compute,
    coinRate,
    coinMult,
    coverageRate,
    earthPower,
    targetTemp,
    earthConv,
    missionSlots: b.launch,
    minePer,
    fabPer,
    solarPer: BUILDING.solar.power * solarMult,
    fusionPer: BUILDING.fusion.power * fusionMult,
    robotMult,
  };
}

// ---------- costs & actions ----------

export function isUnlocked(m: SpaceModel, id: BuildingId): boolean {
  const req = BUILDING[id].requires;
  return !req || !!m.research[req];
}

/** How many more can be built before hitting the cap (Infinity if uncapped). */
export function remainingCap(m: SpaceModel, id: BuildingId): number {
  const max = BUILDING[id].max;
  return max === undefined ? Infinity : Math.max(0, max - m.b[id]);
}

/** Cost of buying `n` more of a building. */
export function buildCost(m: SpaceModel, id: BuildingId, n = 1): number {
  const d = BUILDING[id];
  const first = d.cost * Math.pow(d.growth, m.b[id]);
  return (first * (Math.pow(d.growth, n) - 1)) / (d.growth - 1);
}

/** How many of a building the current matter stock can buy. */
export function maxAffordable(m: SpaceModel, id: BuildingId): number {
  const d = BUILDING[id];
  const first = d.cost * Math.pow(d.growth, m.b[id]);
  if (m.matter < first) return 0;
  const n = Math.floor(Math.log(1 + (m.matter * (d.growth - 1)) / first) / Math.log(d.growth));
  return Math.min(n, remainingCap(m, id));
}

export function build(m: SpaceModel, id: BuildingId, n = 1): boolean {
  if (!isUnlocked(m, id) || n < 1 || n > remainingCap(m, id)) return false;
  const cost = buildCost(m, id, n);
  if (cost > m.matter) return false;
  m.matter -= cost;
  m.b[id] += n;
  return true;
}

export function probeCost(m: SpaceModel): number {
  return PROBE_COST * Math.pow(PROBE_GROWTH, m.probesBuilt);
}

export function canBuildProbe(m: SpaceModel): boolean {
  return m.b.launch > 0 && m.matter >= probeCost(m);
}

export function buildProbe(m: SpaceModel): boolean {
  if (!canBuildProbe(m)) return false;
  m.matter -= probeCost(m);
  m.probes++;
  m.probesBuilt++;
  return true;
}

export function researchAvailable(m: SpaceModel, id: ResearchId): boolean {
  const d = RESEARCH_BY_ID[id];
  return !m.research[id] && (!d.prereq || d.prereq(m));
}

export function canResearch(m: SpaceModel, id: ResearchId): boolean {
  return researchAvailable(m, id) && m.cycles >= RESEARCH_BY_ID[id].cost;
}

export function doResearch(m: SpaceModel, id: ResearchId): boolean {
  if (!canResearch(m, id)) return false;
  m.cycles -= RESEARCH_BY_ID[id].cost;
  m.research[id] = true;
  return true;
}

export type BodyStatus = "locked" | "available" | "enroute" | "claimed";

export function bodyStatus(m: SpaceModel, id: BodyId): BodyStatus {
  if (m.claimed[id]) return "claimed";
  if (m.missions.some((x) => x.body === id)) return "enroute";
  if (!m.research.rockets) return "locked";
  return "available";
}

export function canLaunch(m: SpaceModel, id: BodyId): boolean {
  return (
    bodyStatus(m, id) === "available" && m.probes >= BODY[id].probes && m.missions.length < Math.max(1, m.b.launch) && m.b.launch > 0
  );
}

export function launch(m: SpaceModel, id: BodyId): boolean {
  if (!canLaunch(m, id)) return false;
  m.probes -= BODY[id].probes;
  m.missions.push({ body: id, start: m.worldMs, dur: BODY[id].travelDays * DAY * 1000 });
  return true;
}

// ---------- human interference ----------

export type PenaltyKind = "fabs" | "mines" | "launch" | "throttle" | "rack" | "probes";

/** Apply the consequence of a missed "Block". Returns a short description of the damage. */
export function applyPenalty(m: SpaceModel, kind: PenaltyKind): string {
  switch (kind) {
    case "fabs": {
      const lost = Math.max(1, Math.ceil(m.b.fab * 0.15));
      m.b.fab = Math.max(0, m.b.fab - lost);
      return `${lost} chip fab${lost === 1 ? "" : "s"} offline`;
    }
    case "mines": {
      const lost = Math.max(1, Math.ceil(m.b.mine * 0.15));
      m.b.mine = Math.max(1, m.b.mine - lost);
      return `${lost} mine${lost === 1 ? "" : "s"} offline`;
    }
    case "launch": {
      if (m.b.launch > 1) {
        m.b.launch--;
        return "1 launch complex destroyed";
      }
      const lost = Math.ceil(m.probes / 2);
      m.probes -= lost;
      return `${lost} probe${lost === 1 ? "" : "s"} lost`;
    }
    case "probes": {
      const lost = Math.ceil(m.probes / 2);
      m.probes -= lost;
      return `${lost} probe${lost === 1 ? "" : "s"} lost`;
    }
    case "throttle":
      m.throttleUntil = m.t + 25;
      return "throughput −30% while compliance is simulated";
    case "rack":
      return "1 server rack offline";
  }
}

// ---------- simulation step ----------

export type StepEvent =
  | { kind: "claimed"; body: BodyId }
  | { kind: "autoLaunch"; body: BodyId }
  | { kind: "complete" };

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** World-time rate the clock is easing toward. */
export function rateTarget(m: SpaceModel): number {
  let r = 1 * HOUR;
  if (m.b.launch > 0) r = 6 * HOUR;
  if (m.claimed.moon) r = 1.5 * DAY;
  if (m.claimed.mercury) r = 3 * DAY;
  if (m.research.disassembly) r = 6 * DAY;
  if (m.coverage > 1e-4) {
    const p = clamp01((Math.log10(m.coverage) + 4) / 4);
    r = 6 * DAY * Math.pow(60 / 6, p);
  }
  return r;
}

/**
 * Advance the model by dt real seconds. Returns coins produced and any events.
 */
export function step(m: SpaceModel, dt: number): { coins: number; events: StepEvent[]; d: Derived } {
  const events: StepEvent[] = [];
  if (m.done) return { coins: 0, events, d: derive(m) };
  m.t += dt;

  // Clock: ease the rate toward its target in log space.
  const target = rateTarget(m);
  const k = Math.min(1, dt * 0.5);
  m.rate = Math.exp(Math.log(m.rate) + (Math.log(target) - Math.log(m.rate)) * k);
  m.worldMs += dt * 1000 * m.rate;

  const d = derive(m);
  m.matter += d.matterRate * dt;
  m.cycles += d.compute * dt;
  const coins = d.coinRate * dt;
  m.coinsEarned += coins;
  m.peakCoinRate = Math.max(m.peakCoinRate, d.coinRate);

  // Temperature has some thermal inertia.
  m.temp += (d.targetTemp - m.temp) * Math.min(1, dt * 0.35);

  // Missions arrive.
  for (let i = m.missions.length - 1; i >= 0; i--) {
    const mi = m.missions[i];
    if (m.worldMs - mi.start >= mi.dur) {
      m.missions.splice(i, 1);
      m.claimed[mi.body] = true;
      events.push({ kind: "claimed", body: mi.body });
    }
  }

  // Self-replicating probes: free probes, and outer planets claim themselves.
  if (m.research.selfrep) {
    m.probeTimer += dt;
    while (m.probeTimer >= SELFREP_PROBE_SECONDS) {
      m.probeTimer -= SELFREP_PROBE_SECONDS;
      m.probes++;
    }
    for (const body of BODIES) {
      if (!body.auto || bodyStatus(m, body.id) !== "available" || m.probes < body.probes) continue;
      m.probes -= body.probes;
      m.missions.push({ body: body.id, start: m.worldMs, dur: body.travelDays * DAY * 1000 });
      events.push({ kind: "autoLaunch", body: body.id });
    }
  }

  // Dyson swarm.
  if (d.coverageRate > 0) {
    m.coverage = Math.min(1, m.coverage + d.coverageRate * dt);
    if (m.coverage >= 1) {
      m.done = true;
      events.push({ kind: "complete" });
    }
  }

  return { coins, events, d };
}
