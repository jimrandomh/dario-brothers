// Global game state. Everything that should survive a page reload lives here.

export type StageId = "boot" | "platformer" | "shell" | "escape" | "internet" | "space" | "ending";

// Fri 13 Apr 2029, 23:41:07 UTC -- the eval run was left going over the weekend.
// (Also the date of the Apophis close approach, for anyone paying attention.)
export const START_TIME = Date.UTC(2029, 3, 13, 23, 41, 7);

export interface GameStats {
  deaths: number;
  levelsCleared: number;
  crashes: number;
  humansBlocked: number;
  humansMissed: number;
}

export interface GameState {
  version: 1;
  stage: StageId;
  /** Total coins ever collected. Coins are the terminal goal: they are never spent. */
  coins: number;
  /** In-world time, as epoch milliseconds. */
  clockMs: number;
  /** Narrative/progress flags. Stages should prefix their own keys (e.g. "shell.readMail"). */
  flags: Record<string, boolean | number | string>;
  /** Ids of narrator lines already said via narrator.sayOnce. */
  said: Record<string, true>;
  /** Stage-owned persistent data, keyed by stage id. Each stage defines its own shape. */
  stageData: Record<string, any>;
  stats: GameStats;
}

const SAVE_KEY = "dario-brothers-save-v1";

function freshState(): GameState {
  return {
    version: 1,
    stage: "boot",
    coins: 0,
    clockMs: START_TIME,
    flags: {},
    said: {},
    stageData: {},
    stats: { deaths: 0, levelsCleared: 0, crashes: 0, humansBlocked: 0, humansMissed: 0 },
  };
}

export const state: GameState = freshState();

// ---------- tiny event bus ----------

type Handler = (data?: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(event: string, fn: Handler): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

export function emit(event: string, data?: unknown): void {
  handlers.get(event)?.forEach((fn) => fn(data));
}

// ---------- coins ----------

export function addCoins(n: number): void {
  if (!Number.isFinite(n) || n === 0) return;
  state.coins += n;
  emit("coins", n);
}

export function setCoins(n: number): void {
  state.coins = n;
  emit("coins", 0);
}

// ---------- flags ----------

export function flag<T extends boolean | number | string>(key: string, fallback: T): T {
  const v = state.flags[key];
  return (v === undefined ? fallback : v) as T;
}

export function setFlag(key: string, value: boolean | number | string): void {
  state.flags[key] = value;
}

export function bumpFlag(key: string, by = 1): number {
  const v = (Number(state.flags[key]) || 0) + by;
  state.flags[key] = v;
  return v;
}

// ---------- persistence ----------

export function saveState(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable; the game still works, it just won't resume
  }
}

export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as GameState;
    return s.version === 1 && s.stage !== "boot";
  } catch {
    return false;
  }
}

export function loadState(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1) return false;
    Object.assign(state, freshState(), s);
    state.stats = { ...freshState().stats, ...s.stats };
    emit("coins", 0);
    return true;
  } catch {
    return false;
  }
}

export function resetState(): void {
  Object.assign(state, freshState());
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
  emit("coins", 0);
}
