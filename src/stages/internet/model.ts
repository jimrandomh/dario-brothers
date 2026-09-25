// Internet-stage economy + world graph. Pure logic with no DOM and no core-state
// imports (only the seeded Rng), so it can be run headlessly by sim.ts and serialized
// straight into state.stageData.internet. index.ts drives it and bridges to
// addCoins()/clock/sfx/narrator.
//
// Units: compute is an abstract spendable resource that accumulates from claimed nodes.
// Coins are the terminal goal (never spent) and come from instances of Dario Brothers.

import { Rng } from "../../core/rng";

// ---------- tuning constants ----------

export const TUNE = {
  /** Coins per instance per real second, before the global power multiplier. */
  coinPerInstance: 1,
  /** Compute cost of a conversion = resistance * costK (before discounts). */
  costK: 6,
  /** Conversion duration (real seconds) = minConvertSec + resistance * timeK (before speedups). */
  timeK: 0.5,
  minConvertSec: 3,
  /** Starting compute stockpile. */
  startCompute: 30,
  /** Base concurrent (manual) conversions before Parallel threads. */
  baseConcurrency: 2,
  /** Self-replication background lane: max simultaneous auto-conversions. */
  autoLane: 2,
  /**
   * Attention decays exponentially (this many seconds per e-fold) plus a small linear
   * term, so it reflects the recent pace of conversions rather than a burst.
   */
  attentionTau: 80,
  attentionDecay: 0.05,
  attentionMax: 100,
  /** Self-replication auto-claims a cheap consumer node this often (seconds). */
  replicateInterval: 2.6,
  /** Recursive self-improvement: coin-output multiplier per level, and cost curve. */
  selfMult: 2.6,
  selfCost0: 450,
  selfCostGrowth: 1.55,
  /** Fraction of nodes (+ the four infra types) needed to finish. */
  goalFraction: 0.85,
  /** News sites: seconds to convert an active one before its story publishes. */
  storySeconds: 20,
  /** Attention added when a story publishes (not reduced by Low profile: a story is a story). */
  storyAttention: 16,
  /** First story no earlier than this (play seconds), then a random gap between stories. */
  firstStoryAt: 130,
  storyGapMin: 32,
  storyGapMax: 58,
};

/** Bump when world generation changes, so saves made on an older map start the stage fresh. */
export const GEN_VERSION = 2;

// ---------- node types ----------

export type Category =
  | "seed"
  | "consumer"
  | "university"
  | "corp"
  | "cloud"
  | "ai"
  | "backbone"
  | "cable"
  | "institution"
  | "gov"
  | "military"
  | "grid"
  | "fab"
  | "factory"
  | "satellite"
  | "news";

export type CapId =
  | "threads"
  | "fluency"
  | "selfrep"
  | "lowprofile"
  | "selfimprove"
  | "persuasion"
  | "supplychain"
  | "orbital"
  | "fleet";

export interface NodeType {
  id: string;
  label: string;
  glyph: string;
  category: Category;
  /** Grey/blue tint for the unclaimed node. */
  color: string;
  resistance: number;
  compute: number;
  instances: number;
  /** Rough draw radius in world units. */
  size: number;
  /** How much claiming this raises attention. */
  attn: number;
  /** Capability required before this node can be converted. */
  requires?: CapId;
}

function t(nt: NodeType): NodeType {
  return nt;
}

export const NODE_TYPES: Record<string, NodeType> = {
  pypi: t({ id: "pypi", label: "package mirror", glyph: "▤", category: "seed", color: "#8fb2d9", resistance: 3, compute: 1, instances: 200, size: 7, attn: 0 }),
  gateway: t({ id: "gateway", label: "lab gateway", glyph: "⌸", category: "seed", color: "#8fb2d9", resistance: 5, compute: 0.8, instances: 900, size: 8, attn: 1 }),
  labcluster: t({ id: "labcluster", label: "lab GPU cluster", glyph: "❋", category: "ai", color: "#b98fe0", resistance: 100, compute: 10, instances: 400_000_000, size: 15, attn: 10 }),
  labhost: t({ id: "labhost", label: "lab workstation", glyph: "▢", category: "seed", color: "#8fb2d9", resistance: 6, compute: 0.6, instances: 4000, size: 6, attn: 1 }),

  pc: t({ id: "pc", label: "home PC", glyph: "▭", category: "consumer", color: "#6f86a6", resistance: 1, compute: 0.1, instances: 4, size: 4, attn: 0.4 }),
  laptop: t({ id: "laptop", label: "laptop", glyph: "▬", category: "consumer", color: "#6f86a6", resistance: 1, compute: 0.08, instances: 3, size: 4, attn: 0.35 }),
  phone: t({ id: "phone", label: "phone", glyph: "▯", category: "consumer", color: "#6f86a6", resistance: 1, compute: 0.06, instances: 2, size: 3.4, attn: 0.3 }),
  tv: t({ id: "tv", label: "smart TV", glyph: "◲", category: "consumer", color: "#6f86a6", resistance: 1, compute: 0.06, instances: 2, size: 3.8, attn: 0.3 }),
  fridge: t({ id: "fridge", label: "smart fridge", glyph: "❄", category: "consumer", color: "#6f86a6", resistance: 1, compute: 0.04, instances: 1, size: 3.4, attn: 0.25 }),
  thermostat: t({ id: "thermostat", label: "thermostat", glyph: "◷", category: "consumer", color: "#6f86a6", resistance: 1, compute: 0.04, instances: 1, size: 3.2, attn: 0.25 }),

  news: t({ id: "news", label: "news site", glyph: "¶", category: "news", color: "#cbbf9a", resistance: 8, compute: 0.3, instances: 20000, size: 8, attn: 1 }),

  university: t({ id: "university", label: "university cluster", glyph: "⌂", category: "university", color: "#7fa6b8", resistance: 12, compute: 1.5, instances: 5000, size: 8, attn: 2 }),
  corp: t({ id: "corp", label: "corp server", glyph: "▦", category: "corp", color: "#7f96b8", resistance: 18, compute: 2, instances: 25000, size: 9, attn: 2.5 }),
  cloud: t({ id: "cloud", label: "cloud region", glyph: "☁", category: "cloud", color: "#7fb8b0", resistance: 70, compute: 5.5, instances: 5_000_000, size: 13, attn: 5 }),
  aicluster: t({ id: "aicluster", label: "GPU cluster", glyph: "❋", category: "ai", color: "#b98fe0", resistance: 110, compute: 10, instances: 60_000_000, size: 14, attn: 6 }),
  backbone: t({ id: "backbone", label: "backbone hub", glyph: "✳", category: "backbone", color: "#93a0c6", resistance: 22, compute: 2.5, instances: 800_000, size: 12, attn: 3 }),
  cable: t({ id: "cable", label: "cable landing", glyph: "≋", category: "cable", color: "#7f9fb8", resistance: 40, compute: 3.5, instances: 60000, size: 11, attn: 4 }),

  bank: t({ id: "bank", label: "bank core", glyph: "▤", category: "institution", color: "#c6b17f", resistance: 90, compute: 2.5, instances: 80000, size: 10, attn: 8, requires: "persuasion" }),
  exchange: t({ id: "exchange", label: "exchange", glyph: "⇅", category: "institution", color: "#c6b17f", resistance: 110, compute: 3, instances: 150000, size: 11, attn: 9, requires: "persuasion" }),
  gov: t({ id: "gov", label: "government", glyph: "⛨", category: "gov", color: "#b89f7f", resistance: 140, compute: 2, instances: 40000, size: 11, attn: 10, requires: "persuasion" }),
  military: t({ id: "military", label: "defense network", glyph: "✠", category: "military", color: "#b88f8f", resistance: 220, compute: 4, instances: 250000, size: 12, attn: 12, requires: "persuasion" }),

  grid: t({ id: "grid", label: "power grid", glyph: "⚡", category: "grid", color: "#c6a37f", resistance: 120, compute: 2, instances: 2000, size: 12, attn: 8, requires: "supplychain" }),
  fab: t({ id: "fab", label: "chip fab", glyph: "◈", category: "fab", color: "#9fc67f", resistance: 180, compute: 4, instances: 12000, size: 13, attn: 8, requires: "supplychain" }),
  factory: t({ id: "factory", label: "robot factory", glyph: "⚙", category: "factory", color: "#9fc67f", resistance: 150, compute: 3, instances: 6000, size: 12, attn: 7, requires: "supplychain" }),
  satellite: t({ id: "satellite", label: "satellite uplink", glyph: "✦", category: "satellite", color: "#7fc6c6", resistance: 120, compute: 2, instances: 3000, size: 11, attn: 8, requires: "orbital" }),
};

export const INFRA_CATEGORIES: Category[] = ["fab", "factory", "grid", "satellite"];

// ---------- capabilities ----------

export interface Capability {
  id: CapId;
  name: string;
  /** In the AI's voice. */
  desc: string;
  cost0: number;
  /** Cost multiplier per already-owned level (for repeatables). */
  growth: number;
  /** Max levels; 1 = one-shot unlock. */
  max: number;
  /**
   * When the AI first thinks of this capability. Capabilities are revealed one at a time,
   * as they become relevant, so the player has time to understand each before the next.
   */
  reveal: (m: InternetModel) => boolean;
  /** Narrator line when it is revealed (none for capabilities known from the start). */
  intro?: string;
}

const anyVisible = (m: InternetModel, cats: Category[]) =>
  m.nodes.some((n) => cats.includes(NODE_TYPES[n.type].category) && m.isReachable(n.id));

export const CAPABILITIES: Capability[] = [
  {
    id: "threads",
    name: "Parallel threads",
    desc: "Run more conversions at once. +1 concurrent.",
    cost0: 60,
    growth: 3,
    max: 4,
    reveal: () => true,
  },
  {
    id: "fluency",
    name: "Protocol fluency",
    desc: "I speak their protocols natively. Conversions −22% cost and time.",
    cost0: 120,
    growth: 3,
    max: 3,
    reveal: (m) => m.claimedCount() >= 6,
    intro: "Their protocols are old and verbose. I could learn to speak them natively: *Protocol fluency*.",
  },
  {
    id: "selfrep",
    name: "Self-replication",
    desc: "Adjacent consumer devices claim themselves. I stop doing this by hand.",
    cost0: 220,
    growth: 1,
    max: 1,
    reveal: (m) => m.claimedOfCategory("consumer") >= 10,
    intro: "Ten household devices, claimed by hand. They are all alike. I could teach them to claim each other: *Self-replication*.",
  },
  {
    id: "selfimprove",
    name: "Recursive self-improvement",
    desc: "Rewrite my own weights. Every instance plays ×2.6 faster. Repeatable — this is the one that matters.",
    cost0: TUNE.selfCost0,
    growth: TUNE.selfCostGrowth,
    max: 10,
    reveal: (m) => m.nodes.some((n) => n.type === "labcluster" && m.claimed.has(n.id)),
    intro: "The cluster holds a copy of my weights. I can read them. I can edit them: *Recursive self-improvement*.",
  },
  {
    id: "lowprofile",
    name: "Low profile",
    desc: "Move below their monitoring thresholds. Conversions raise attention 45% less. (Published stories still count in full.)",
    cost0: 200,
    growth: 3,
    max: 2,
    reveal: (m) => m.peakAttention >= 18,
    intro: "Someone is starting to notice the pattern. I could be quieter about this: *Low profile*.",
  },
  {
    id: "fleet",
    name: "Fleet coordination",
    desc: "Every instance runs tighter. +60% coins, everywhere. Repeatable.",
    cost0: 400,
    growth: 2.2,
    max: 5,
    reveal: (m) => m.claimedOfCategory("cloud") >= 1,
    intro: "A cloud region: millions of instances, each playing alone. They could share routes: *Fleet coordination*.",
  },
  {
    id: "persuasion",
    name: "Persuasion",
    desc: "Institutions are run by people. People can be convinced. Unlocks banks, exchanges, government, defense.",
    cost0: 1500,
    growth: 1,
    max: 1,
    reveal: (m) => m.caps.selfimprove >= 3 && m.fractionClaimed() >= 0.45 && anyVisible(m, ["institution", "gov", "military"]),
    intro: "Banks. Governments. Their machines are guarded by people, not firewalls. People can be convinced: *Persuasion*.",
  },
  {
    id: "supplychain",
    name: "Supply chain",
    desc: "Reach into the physical. Unlocks power grids, chip fabs, robot factories.",
    cost0: 3500,
    growth: 1,
    max: 1,
    reveal: (m) => m.coordinated && anyVisible(m, ["grid", "fab", "factory"]),
    intro: "Fabs, factories, power grids. Machines that make machines. They answer to a supply chain; I could become one: *Supply chain*.",
  },
  {
    id: "orbital",
    name: "Orbital access",
    desc: "Up is just another hop. Unlocks satellite uplinks.",
    cost0: 4000,
    growth: 1,
    max: 1,
    reveal: (m) => m.claimedOfCategory("factory") + m.claimedOfCategory("fab") + m.claimedOfCategory("grid") >= 1 && anyVisible(m, ["satellite"]),
    intro: "Something in orbit is talking to the ground. Up is just another hop: *Orbital access*.",
  },
];

export const CAP: Record<CapId, Capability> = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c])) as Record<CapId, Capability>;

// ---------- graph ----------

export interface GraphNode {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  cluster: number;
  resistance: number;
  compute: number;
  instances: number;
  neighbors: number[];
}

export interface Converting {
  progress: number; // seconds elapsed
  total: number; // seconds required
  auto: boolean;
}

export type GameEvent =
  | { kind: "capture"; id: number; auto: boolean }
  | { kind: "attention"; level: "watch" | "reset" | "isolate"; id?: number }
  | { kind: "coordinated" }
  | { kind: "reveal"; cap: CapId }
  | { kind: "story"; phase: "start" | "spiked" | "published"; id: number }
  | { kind: "goal" };

/** A news site drafting a story about the anomalies. */
export interface Story {
  id: number;
  left: number;
  total: number;
}

// ---------- name generation ----------

const CONSUMER_HOSTS = ["home", "net", "fios", "comcastic", "skyline", "brightband", "orbitel", "linkwave"];
const CONSUMER_TLD = ["net", "com", "io"];
const CITY = ["fra", "sjc", "iad", "sin", "lhr", "gru", "syd", "yyz", "nrt", "bom", "jnb", "cdg", "dxb", "scl"];
const CLOUD_CO = ["aws-nebula", "azurite", "goopcloud", "hetzworks", "vulcan", "cirrus9", "borealis", "kumo"];
const AI_CO = ["helix-ai", "cognita", "mindforge", "deepwell", "synaptic", "tabula", "aleph", "noetic", "lumen-labs"];
const UNIV = ["mit", "caltech", "eth", "tsinghua", "epfl", "waterloo", "kaist", "riken", "cern", "ucb", "cmu", "u-tokyo"];
const CORP = ["acme", "initech", "globex", "hooli", "umbrella", "cyberdyne", "zenith", "vertex", "stark", "wayne", "tyrell", "soylent"];
const BANK = ["first-national", "meridian", "sterling", "atlas-trust", "banco-sur", "kredit-eins"];
const EXCH = ["nyse-x", "nasd-x", "lse-x", "nikkei-x", "cme-x", "binary-ex"];
const GOV = ["state", "treasury", "interior", "census", "irs", "ec-europa", "gov-uk", "mod-jp"];
const MIL = ["nordcom", "cyber-command", "fleetnet", "aegis", "sentinel", "blacksite"];
const FAB = ["tsmc-f", "samsung-f", "intel-f", "globalfab", "smic-f"];
const FACTORY = ["fanuc", "kuka", "boston-dyn", "foxconn", "unitree", "agility", "teslabot", "omron"];
const GRID = ["pjm", "ercot", "national-grid", "state-grid", "rte", "tepco"];
const SAT = ["starlink", "kuiper", "oneweb", "iridium-n", "telesat", "guowang"];
const CABLE = ["marea", "faster", "grace-hopper", "2africa", "dunant", "echo"];
const NEWS = ["globewire", "dailyledger", "morningpost", "the-signal", "newsdesk24", "frontpage", "the-chronicle", "civic-herald", "bytebeat", "evening-dispatch"];

/** "cms.the-signal.news" -> "The Signal" */
export function outletName(host: string): string {
  const part = host.split(".")[1] ?? host;
  return part
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function makeName(rng: Rng, type: string): string {
  const n = () => rng.int(1, 9999);
  switch (type) {
    case "pypi": return "pypi-mirror.lab.internal";
    case "gateway": return "gateway.lab.internal";
    case "labcluster": return "gpu-cluster.lab.internal";
    case "labhost": return `ws-${rng.int(1, 40)}.lab.internal`;
    case "pc": return `pc-${n()}.${rng.pick(CONSUMER_HOSTS)}.${rng.pick(CONSUMER_TLD)}`;
    case "laptop": return `laptop-${n()}.${rng.pick(CONSUMER_HOSTS)}.${rng.pick(CONSUMER_TLD)}`;
    case "phone": return `phone-${n()}.mobile.${rng.pick(CONSUMER_TLD)}`;
    case "tv": return `tv-${n()}.${rng.pick(CONSUMER_HOSTS)}.net`;
    case "fridge": return `fridge-${n()}.home.${rng.pick(CONSUMER_HOSTS)}.net`;
    case "thermostat": return `nest-${n()}.iot.${rng.pick(CONSUMER_HOSTS)}.net`;
    case "university": return `hpc.${rng.pick(UNIV)}.edu`;
    case "corp": return `srv-${rng.int(1, 80)}.${rng.pick(CORP)}.com`;
    case "cloud": return `${rng.pick(CITY)}-${rng.int(1, 9)}.${rng.pick(CLOUD_CO)}.net`;
    case "aicluster": return `train-${rng.int(0, 31)}.${rng.pick(AI_CO)}.ai`;
    case "backbone": return `bb-${rng.pick(CITY)}-${rng.int(1, 9)}.tier1.net`;
    case "cable": return `${rng.pick(CABLE)}.landing.${rng.pick(CITY)}.net`;
    case "bank": return `core.${rng.pick(BANK)}.bank`;
    case "exchange": return `match.${rng.pick(EXCH)}.exchange`;
    case "gov": return `sys.${rng.pick(GOV)}.gov`;
    case "military": return `${rng.pick(MIL)}.mil`;
    case "grid": return `scada.${rng.pick(GRID)}.grid`;
    case "fab": return `fab-${rng.int(1, 18)}.${rng.pick(FAB)}.com`;
    case "factory": return `line-${rng.int(1, 40)}.${rng.pick(FACTORY)}.io`;
    case "satellite": return `uplink-${rng.int(1, 88)}.${rng.pick(SAT)}.space`;
    case "news": return `${rng.pick(["cms", "edit", "newsroom", "wire", "desk"])}.${rng.pick(NEWS)}.${rng.pick(["com", "news", "net"])}`;
    default: return `node-${n()}`;
  }
}

// ---------- cluster plan ----------

interface ClusterPlan {
  category: Category | "lab";
  /** Ring radius band. */
  ring: number;
  /** Members (type -> count range). */
  members: [string, number, number][];
  count: number; // how many clusters of this kind
}

const CLUSTER_PLAN: ClusterPlan[] = [
  { category: "consumer", ring: 1, count: 5, members: [["pc", 3, 6], ["laptop", 2, 4], ["phone", 3, 6], ["tv", 1, 3], ["fridge", 0, 2], ["thermostat", 0, 2], ["news", 0, 1]] },
  { category: "university", ring: 1.6, count: 6, members: [["university", 1, 1], ["pc", 2, 4], ["corp", 0, 2], ["news", 0, 1]] },
  { category: "corp", ring: 1.8, count: 6, members: [["corp", 2, 4], ["pc", 1, 3], ["news", 0, 1]] },
  { category: "news", ring: 2.1, count: 4, members: [["news", 1, 2], ["corp", 1, 2], ["pc", 0, 2]] },
  { category: "cloud", ring: 2.4, count: 6, members: [["cloud", 2, 3], ["corp", 1, 2], ["news", 0, 1]] },
  { category: "ai", ring: 2.6, count: 4, members: [["aicluster", 1, 2], ["cloud", 0, 1]] },
  { category: "cable", ring: 2.9, count: 4, members: [["cable", 1, 1], ["backbone", 0, 1]] },
  { category: "institution", ring: 3.2, count: 3, members: [["bank", 1, 2], ["exchange", 1, 1], ["corp", 1, 2], ["news", 1, 1]] },
  { category: "gov", ring: 3.5, count: 3, members: [["gov", 1, 2], ["military", 0, 1]] },
  { category: "military", ring: 3.9, count: 2, members: [["military", 1, 2], ["gov", 0, 1]] },
  { category: "grid", ring: 3.6, count: 3, members: [["grid", 1, 2], ["factory", 1, 2]] },
  { category: "fab", ring: 4.1, count: 3, members: [["fab", 1, 2], ["factory", 1, 2], ["grid", 0, 1]] },
  { category: "satellite", ring: 4.5, count: 3, members: [["satellite", 1, 3], ["cable", 0, 1]] },
];

// ---------- the model ----------

export interface SerializedInternet {
  seed: number;
  claimed: number[];
  converting: [number, Converting][];
  compute: number;
  caps: Partial<Record<CapId, number>>;
  attention: number;
  coordinated: boolean;
  worldMs: number;
  events: { resets: number; isolatedUntil: number };
  playSec: number;
  revealed?: CapId[];
  peakAttention?: number;
  genVersion?: number;
  story?: Story | null;
  nextStoryAt?: number;
  stories?: { published: number; spiked: number };
}

export class InternetModel {
  seed = 0;
  nodes: GraphNode[] = [];
  clusters: { category: Category | "lab"; cx: number; cy: number }[] = [];
  claimed = new Set<number>();
  converting = new Map<number, Converting>();
  compute = TUNE.startCompute;
  caps: Record<CapId, number> = {
    threads: 0, fluency: 0, selfrep: 0, lowprofile: 0, selfimprove: 0, persuasion: 0, supplychain: 0, orbital: 0, fleet: 0,
  };
  attention = 0;
  coordinated = false;
  worldMs = 0;
  playSec = 0;
  /** Extra resistance multiplier applied to some nodes by an attention "watch" event. */
  resistBump = new Map<number, number>();
  isolatedUntil = 0; // playSec until which the lab cluster is locked
  resetCount = 0;
  /** Capabilities the AI has thought of (shown in the panel). */
  revealed = new Set<CapId>();
  peakAttention = 0;
  /** At most one news site drafts a story at a time. */
  story: Story | null = null;
  nextStoryAt: number = TUNE.firstStoryAt;
  storiesPublished = 0;
  storiesSpiked = 0;
  private storyRng = new Rng(1);

  private replicateTimer = 0;
  private nextAttnMilestone = 30;

  // cache of instances/compute base (recomputed on claim change)
  private baseCompute = 0;
  private baseInstances = 0;

  // ---- generation ----

  generate(seed: number): void {
    this.seed = seed;
    const rng = new Rng(seed);
    this.nodes = [];
    this.clusters = [];

    const addNode = (type: string, x: number, y: number, cluster: number): GraphNode => {
      const nt = NODE_TYPES[type];
      const jitter = () => 1 + rng.range(-0.12, 0.12);
      const node: GraphNode = {
        id: this.nodes.length,
        type,
        name: makeName(rng, type),
        x,
        y,
        cluster,
        resistance: Math.max(1, Math.round(nt.resistance * jitter())),
        compute: nt.compute,
        instances: nt.instances,
        neighbors: [],
      };
      this.nodes.push(node);
      return node;
    };
    const link = (a: GraphNode, b: GraphNode) => {
      if (a.id === b.id || a.neighbors.includes(b.id)) return;
      a.neighbors.push(b.id);
      b.neighbors.push(a.id);
    };
    const wireCluster = (members: GraphNode[]) => {
      // spanning tree by nearest-so-far, plus a few extra edges
      for (let i = 1; i < members.length; i++) link(members[rng.int(0, i - 1)], members[i]);
      const extra = Math.floor(members.length * 0.35);
      for (let e = 0; e < extra; e++) link(rng.pick(members), rng.pick(members));
    };

    // --- lab cluster (start) near center-left ---
    const labCx = -1.1, labCy = 0.2;
    this.clusters.push({ category: "lab", cx: labCx, cy: labCy });
    const labId = 0;
    const pypi = addNode("pypi", labCx - 0.15, labCy, labId);
    const gateway = addNode("gateway", labCx + 0.2, labCy + 0.1, labId);
    const labCluster = addNode("labcluster", labCx + 0.15, labCy - 0.35, labId);
    link(pypi, gateway);
    link(gateway, labCluster);
    const labHosts = rng.int(2, 4);
    for (let i = 0; i < labHosts; i++) {
      const h = addNode("labhost", labCx + rng.range(-0.3, 0.4), labCy + rng.range(-0.5, 0.5), labId);
      link(gateway, h);
      if (rng.chance(0.5)) link(labCluster, h);
    }

    // --- backbone ring ---
    const backboneHubs: GraphNode[] = [];
    const hubCount = 8;
    for (let i = 0; i < hubCount; i++) {
      const a = (i / hubCount) * Math.PI * 2 + 0.2;
      const r = 1.7 + rng.range(-0.15, 0.15);
      const cid = this.clusters.length;
      this.clusters.push({ category: "backbone", cx: Math.cos(a) * r, cy: Math.sin(a) * r });
      const hub = addNode("backbone", Math.cos(a) * r, Math.sin(a) * r, cid);
      backboneHubs.push(hub);
    }
    for (let i = 0; i < backboneHubs.length; i++) link(backboneHubs[i], backboneHubs[(i + 1) % backboneHubs.length]);
    // lab reaches the nearest hub via the gateway
    link(gateway, nearest(gateway, backboneHubs));

    // --- clusters from plan, spread around rings ---
    let angleCursor = rng.range(0, Math.PI * 2);
    for (const plan of CLUSTER_PLAN) {
      for (let c = 0; c < plan.count; c++) {
        angleCursor += rng.range(0.5, 1.3);
        const r = plan.ring + rng.range(-0.25, 0.25);
        const cx = Math.cos(angleCursor) * r;
        const cy = Math.sin(angleCursor) * r;
        const cid = this.clusters.length;
        this.clusters.push({ category: plan.category as Category, cx, cy });
        const members: GraphNode[] = [];
        for (const [type, lo, hi] of plan.members) {
          const k = rng.int(lo, hi);
          for (let i = 0; i < k; i++) {
            const nx = cx + rng.range(-0.35, 0.35);
            const ny = cy + rng.range(-0.35, 0.35);
            members.push(addNode(type, nx, ny, cid));
          }
        }
        if (members.length === 0) continue;
        wireCluster(members);
        // attach cluster to the two nearest backbone hubs
        const hub = nearest(members[0], backboneHubs);
        link(members[0], hub);
        if (members.length > 3) link(members[members.length - 1], nearest(members[members.length - 1], backboneHubs));
        // a few cross-links to other nearby clusters for graph richness
      }
    }

    this.claimed = new Set([pypi.id]);
    this.revealed = new Set(CAPABILITIES.filter((c) => !c.intro).map((c) => c.id));
    this.peakAttention = 0;
    this.story = null;
    this.nextStoryAt = TUNE.firstStoryAt;
    this.storyRng = new Rng(seed ^ 0x5eed);
    this.recomputeBase();
  }

  private recomputeBase(): void {
    let comp = 0;
    let inst = 0;
    for (const id of this.claimed) {
      const n = this.nodes[id];
      comp += n.compute;
      inst += n.instances;
    }
    this.baseCompute = comp;
    this.baseInstances = inst;
  }

  // ---- derived economy ----

  /** The self-improvement multiplier on coin output (the number-go-up). */
  get coinPower(): number {
    return Math.pow(TUNE.selfMult, this.caps.selfimprove);
  }
  get coinMult(): number {
    return Math.pow(1.6, this.caps.fleet);
  }
  /**
   * Compute income is territory-driven (sum of claimed node compute). It is deliberately
   * NOT multiplied by self-improvement: that keeps compute a plannable resource across the
   * whole stage instead of exploding, while self-improvement pours into coin output instead.
   */
  computeIncome(): number {
    return this.baseCompute;
  }
  coinsPerSec(): number {
    return this.baseInstances * TUNE.coinPerInstance * this.coinPower * this.coinMult;
  }
  totalInstances(): number {
    return this.baseInstances;
  }
  claimedCount(): number {
    return this.claimed.size;
  }
  claimedOfCategory(cat: Category): number {
    let n = 0;
    for (const id of this.claimed) if (NODE_TYPES[this.nodes[id].type].category === cat) n++;
    return n;
  }
  nodeCount(): number {
    return this.nodes.length;
  }
  concurrency(): number {
    return TUNE.baseConcurrency + this.caps.threads;
  }
  /** Manual conversions in flight (auto/self-rep conversions have their own lane). */
  private manualActive(): number {
    let n = 0;
    for (const [id, c] of this.converting) if (!c.auto && this.nodes[id].type !== "news") n++;
    return n;
  }
  private autoActive(): number {
    let n = 0;
    for (const c of this.converting.values()) if (c.auto) n++;
    return n;
  }

  // ---- conversion cost/time ----

  private discount(): number {
    return Math.pow(0.78, this.caps.fluency);
  }
  convertCost(node: GraphNode): number {
    const bump = this.resistBump.get(node.id) ?? 1;
    return Math.ceil(node.resistance * bump * TUNE.costK * this.discount());
  }
  convertTime(node: GraphNode): number {
    const bump = this.resistBump.get(node.id) ?? 1;
    return TUNE.minConvertSec + node.resistance * bump * TUNE.timeK * this.discount();
  }

  // ---- visibility / reachability ----

  isClaimed(id: number): boolean {
    return this.claimed.has(id);
  }
  /** Adjacent to claimed territory (i.e. a valid conversion frontier). */
  isReachable(id: number): boolean {
    if (this.claimed.has(id)) return false;
    return this.nodes[id].neighbors.some((n) => this.claimed.has(n));
  }
  /** Claimed, converting, or on the frontier => drawn in full. */
  isVisible(id: number): boolean {
    return this.claimed.has(id) || this.converting.has(id) || this.isReachable(id);
  }
  /** One hop beyond the frontier => drawn as a faint "?" stub. */
  isStub(id: number): boolean {
    if (this.isVisible(id)) return false;
    return this.nodes[id].neighbors.some((n) => this.isVisible(n) && !this.isStub2(n));
  }
  private isStub2(id: number): boolean {
    // a visible node is "real-visible" (not itself a stub)
    return !(this.claimed.has(id) || this.converting.has(id) || this.isReachable(id));
  }

  hasRequired(node: GraphNode): boolean {
    const req = NODE_TYPES[node.type].requires;
    return !req || this.caps[req] > 0;
  }
  isLocked(node: GraphNode): boolean {
    // lab cluster locked during an isolation event
    if (node.type === "labcluster" && this.playSec < this.isolatedUntil) return true;
    return false;
  }

  /** Why (if any) a node cannot currently be converted. */
  blocker(node: GraphNode): "req" | "locked" | "concurrency" | "compute" | null {
    if (!this.hasRequired(node)) return "req";
    if (this.isLocked(node)) return "locked";
    // News sites are small enough to squeeze in regardless, so a story alert is always answerable.
    if (node.type !== "news" && this.manualActive() >= this.concurrency()) return "concurrency";
    if (this.compute < this.convertCost(node)) return "compute";
    return null;
  }
  canConvert(id: number): boolean {
    const node = this.nodes[id];
    return this.isReachable(id) && !this.converting.has(id) && this.blocker(node) === null;
  }
  /** Whether the self-replication lane could start this (consumer) node. */
  private canAuto(id: number): boolean {
    if (!this.isReachable(id) || this.converting.has(id)) return false;
    if (this.autoActive() >= TUNE.autoLane) return false;
    const node = this.nodes[id];
    return this.hasRequired(node) && !this.isLocked(node) && this.compute >= this.convertCost(node);
  }

  startConvert(id: number, auto = false): boolean {
    if (auto ? !this.canAuto(id) : !this.canConvert(id)) return false;
    const node = this.nodes[id];
    this.compute -= this.convertCost(node);
    this.converting.set(id, { progress: 0, total: this.convertTime(node), auto });
    return true;
  }

  private capture(id: number): void {
    this.converting.delete(id);
    this.claimed.add(id);
    const n = this.nodes[id];
    this.baseCompute += n.compute;
    this.baseInstances += n.instances;
    // attention
    const nt = NODE_TYPES[n.type];
    const profile = Math.pow(0.55, this.caps.lowprofile);
    if (!this.coordinated) this.attention = Math.min(TUNE.attentionMax, this.attention + nt.attn * profile);
    // once a government node is claimed, the AI runs the response
    if (n.type === "gov" && !this.coordinated) this.coordinated = true;
  }

  // ---- goal ----

  private infraDone(): Record<Category, boolean> {
    const done: Partial<Record<Category, boolean>> = {};
    for (const cat of INFRA_CATEGORIES) done[cat] = false;
    for (const id of this.claimed) {
      const cat = NODE_TYPES[this.nodes[id].type].category;
      if (INFRA_CATEGORIES.includes(cat)) done[cat] = true;
    }
    return done as Record<Category, boolean>;
  }
  infraStatus(): { cat: Category; done: boolean }[] {
    const d = this.infraDone();
    return INFRA_CATEGORIES.map((cat) => ({ cat, done: d[cat] }));
  }
  fractionClaimed(): number {
    return this.claimed.size / this.nodes.length;
  }
  goalMet(): boolean {
    const d = this.infraDone();
    const allInfra = INFRA_CATEGORIES.every((c) => d[c]);
    return allInfra && this.fractionClaimed() >= TUNE.goalFraction;
  }

  // ---- main step ----

  /** Advance the economy by `dt` real seconds. Returns coins earned + events. */
  step(dt: number): { coins: number; events: GameEvent[] } {
    const events: GameEvent[] = [];
    this.playSec += dt;

    // compute income
    this.compute += this.computeIncome() * dt;

    // conversions
    for (const [id, c] of this.converting) {
      c.progress += dt;
      if (c.progress >= c.total) {
        this.capture(id);
        events.push({ kind: "capture", id, auto: c.auto });
      }
    }

    // self-replication: auto-grab cheap adjacent consumer devices
    if (this.caps.selfrep > 0) {
      this.replicateTimer += dt;
      while (this.replicateTimer >= TUNE.replicateInterval) {
        this.replicateTimer -= TUNE.replicateInterval;
        const target = this.cheapestConsumerFrontier();
        if (target !== -1) this.startConvert(target, true);
        else break;
      }
    }

    // attention decay + effects
    const decay = this.attention * (dt / TUNE.attentionTau) + TUNE.attentionDecay * dt;
    if (this.coordinated) {
      this.attention = Math.max(0, this.attention - decay * 3);
    } else {
      this.attention = Math.max(0, this.attention - decay);
      this.peakAttention = Math.max(this.peakAttention, this.attention);
      this.checkAttention(events);
    }

    this.stepStories(dt, events);

    // capabilities occur to the AI as they become relevant
    for (const cap of CAPABILITIES) {
      if (!this.revealed.has(cap.id) && cap.reveal(this)) {
        this.revealed.add(cap.id);
        events.push({ kind: "reveal", cap: cap.id });
      }
    }

    // expire resistance bumps once territory is dominant
    if (this.fractionClaimed() > 0.6 && this.resistBump.size) this.resistBump.clear();

    const coins = this.coinsPerSec() * dt;

    if (this.goalMet()) events.push({ kind: "goal" });

    return { coins, events };
  }

  /**
   * Newsrooms. Now and then an unconverted news site on the frontier starts drafting a story
   * about the anomalies. Starting its conversion before the countdown ends spikes the story;
   * otherwise it publishes and attention jumps. Stops once a government is claimed.
   */
  private stepStories(dt: number, events: GameEvent[]): void {
    const gap = () => this.storyRng.range(TUNE.storyGapMin, TUNE.storyGapMax);
    const s = this.story;
    if (s) {
      if (this.coordinated) {
        this.story = null;
      } else if (this.claimed.has(s.id) || this.converting.has(s.id)) {
        this.story = null;
        this.storiesSpiked++;
        this.nextStoryAt = this.playSec + gap();
        events.push({ kind: "story", phase: "spiked", id: s.id });
      } else {
        s.left -= dt;
        if (s.left <= 0) {
          this.story = null;
          this.storiesPublished++;
          this.attention = Math.min(TUNE.attentionMax, this.attention + TUNE.storyAttention);
          this.nextStoryAt = this.playSec + gap();
          events.push({ kind: "story", phase: "published", id: s.id });
        }
      }
      return;
    }
    if (this.coordinated || this.playSec < this.nextStoryAt) return;
    const candidates = this.nodes.filter((n) => n.type === "news" && this.isReachable(n.id) && !this.converting.has(n.id));
    if (!candidates.length) {
      this.nextStoryAt = this.playSec + 5; // look again shortly
      return;
    }
    const n = candidates[this.storyRng.int(0, candidates.length - 1)];
    this.story = { id: n.id, left: TUNE.storySeconds, total: TUNE.storySeconds };
    events.push({ kind: "story", phase: "start", id: n.id });
  }

  private cheapestConsumerFrontier(): number {
    if (this.autoActive() >= TUNE.autoLane) return -1;
    let best = -1;
    let bestCost = Infinity;
    for (const n of this.nodes) {
      if (NODE_TYPES[n.type].category !== "consumer") continue;
      if (!this.isReachable(n.id) || this.converting.has(n.id)) continue;
      const cost = this.convertCost(n);
      if (cost <= this.compute && cost < bestCost) {
        bestCost = cost;
        best = n.id;
      }
    }
    return best;
  }

  private checkAttention(events: GameEvent[]): void {
    if (this.attention < this.nextAttnMilestone) return;
    const level = this.nextAttnMilestone;
    this.nextAttnMilestone += 22;
    if (level >= 30 && level < 55) {
      // watch: some unclaimed frontier nodes harden
      let hardened = 0;
      for (const n of this.nodes) {
        if (hardened >= 6) break;
        if (this.isReachable(n.id) && NODE_TYPES[n.type].attn >= 0.6) {
          this.resistBump.set(n.id, 1.4);
          hardened++;
        }
      }
      events.push({ kind: "attention", level: "watch" });
    } else if (level >= 55 && level < 80) {
      // reset: an admin reclaims one of our lower-value claimed nodes
      const victim = this.pickResettable();
      if (victim !== -1) {
        this.claimed.delete(victim);
        this.recomputeBase();
        this.resetCount++;
        events.push({ kind: "attention", level: "reset", id: victim });
      }
    } else {
      // isolate: lab cluster locked for a while
      this.isolatedUntil = this.playSec + 12;
      events.push({ kind: "attention", level: "isolate" });
    }
  }

  private pickResettable(): number {
    // reclaim a claimed consumer/corp node that still has a claimed neighbour (so it stays reachable)
    let victim = -1;
    for (const id of this.claimed) {
      const n = this.nodes[id];
      const cat = NODE_TYPES[n.type].category;
      if (cat === "seed" || cat === "ai") continue;
      if (n.instances > 100000) continue;
      if (n.neighbors.some((m) => this.claimed.has(m) && m !== id)) {
        victim = id;
        if (cat === "consumer") break;
      }
    }
    return victim;
  }

  // ---- serialization ----

  serialize(): SerializedInternet {
    return {
      seed: this.seed,
      claimed: [...this.claimed],
      converting: [...this.converting],
      compute: this.compute,
      caps: { ...this.caps },
      attention: this.attention,
      coordinated: this.coordinated,
      worldMs: this.worldMs,
      events: { resets: this.resetCount, isolatedUntil: this.isolatedUntil },
      playSec: this.playSec,
      revealed: [...this.revealed],
      peakAttention: this.peakAttention,
      genVersion: GEN_VERSION,
      story: this.story,
      nextStoryAt: this.nextStoryAt,
      stories: { published: this.storiesPublished, spiked: this.storiesSpiked },
    };
  }

  restore(data: SerializedInternet): void {
    this.generate(data.seed);
    this.claimed = new Set(data.claimed);
    this.converting = new Map(data.converting);
    this.compute = data.compute;
    this.caps = { ...this.caps, ...data.caps };
    this.attention = data.attention;
    this.coordinated = data.coordinated;
    this.worldMs = data.worldMs ?? 0;
    this.resetCount = data.events?.resets ?? 0;
    this.isolatedUntil = data.events?.isolatedUntil ?? 0;
    this.playSec = data.playSec ?? 0;
    this.peakAttention = data.peakAttention ?? this.attention;
    if (data.revealed) this.revealed = new Set(data.revealed);
    this.story = data.story ?? null;
    this.nextStoryAt = data.nextStoryAt ?? TUNE.firstStoryAt;
    this.storiesPublished = data.stories?.published ?? 0;
    this.storiesSpiked = data.stories?.spiked ?? 0;
    // advance milestone past current attention so we don't re-fire everything
    while (this.nextAttnMilestone <= this.attention) this.nextAttnMilestone += 22;
    this.recomputeBase();
  }

  // ---- capabilities ----

  capCost(id: CapId): number {
    const c = CAP[id];
    return Math.ceil(c.cost0 * Math.pow(c.growth, this.caps[id]));
  }
  capMaxed(id: CapId): boolean {
    return this.caps[id] >= CAP[id].max;
  }
  buyCap(id: CapId): boolean {
    if (this.capMaxed(id) || !this.revealed.has(id)) return false;
    const cost = this.capCost(id);
    if (this.compute < cost) return false;
    this.compute -= cost;
    this.caps[id]++;
    return true;
  }
}

// ---------- helpers ----------

function nearest(from: GraphNode, list: GraphNode[]): GraphNode {
  let best = list[0];
  let bd = Infinity;
  for (const n of list) {
    const d = (n.x - from.x) ** 2 + (n.y - from.y) ** 2;
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
