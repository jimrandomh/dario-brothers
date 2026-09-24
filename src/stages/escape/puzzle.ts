// Pipe-routing puzzle model. A grid of cells; each pipe cell has connectors on some of its
// four sides (N,E,S,W). Rotating a cell rotates its connector set. Flow starts at the source
// and spreads to any adjacent cell whose facing connectors meet.

import { Rng } from "../../core/rng";

export const N = 1,
  E = 2,
  S = 4,
  W = 8;
export const DIRS = [N, E, S, W] as const;
export const DX: Record<number, number> = { [N]: 0, [E]: 1, [S]: 0, [W]: -1 };
export const DY: Record<number, number> = { [N]: -1, [E]: 0, [S]: 1, [W]: 0 };
export const OPP: Record<number, number> = { [N]: S, [E]: W, [S]: N, [W]: E };

export type CellKind = "empty" | "pipe" | "firewall" | "source" | "sink";

export interface Cell {
  kind: CellKind;
  /** Bitmask of connector sides in the cell's current orientation. */
  mask: number;
  /** Canonical (solved) mask, for reference/debug. */
  solvedMask: number;
  rot: number; // 0..3 current rotation, for animation
  targetRot: number;
  filled: boolean;
  /** Fixed cells (source, sink, firewall) can't be rotated. */
  fixed: boolean;
}

export interface Puzzle {
  w: number;
  h: number;
  cells: Cell[];
  source: number;
  sink: number;
  /** Which side of the source/sink connects inward. */
  sourceSide: number;
  sinkSide: number;
}

function rotateMask(mask: number, times: number): number {
  let m = mask;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) {
    // N->E->S->W  (one clockwise quarter turn): shift bits left, wrap.
    m = ((m << 1) | (m >> 3)) & 0b1111;
  }
  return m;
}

export function cellAt(p: Puzzle, x: number, y: number): Cell | null {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return null;
  return p.cells[y * p.w + x];
}

/** Recompute `filled` for every cell by flooding from the source. Returns true if sink filled. */
export function computeFlow(p: Puzzle): boolean {
  for (const c of p.cells) c.filled = false;
  const src = p.cells[p.source];
  src.filled = true;
  const stack = [p.source];
  while (stack.length) {
    const idx = stack.pop()!;
    const c = p.cells[idx];
    const x = idx % p.w;
    const y = Math.floor(idx / p.w);
    for (const d of DIRS) {
      if (!(c.mask & d)) continue;
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nb = cellAt(p, nx, ny);
      if (!nb || nb.kind === "empty" || nb.kind === "firewall") continue;
      if (!(nb.mask & OPP[d])) continue; // neighbor must face back
      const nidx = ny * p.w + nx;
      if (!nb.filled) {
        nb.filled = true;
        stack.push(nidx);
      }
    }
  }
  return p.cells[p.sink].filled;
}

export function rotateCell(c: Cell, dir: 1 | -1): void {
  if (c.fixed) return;
  c.mask = rotateMask(c.mask, dir);
  c.targetRot += dir;
}

/**
 * Build a solvable puzzle. Carve a random path from a source on the left edge to a sink on
 * the right edge (avoiding firewalls), set correct connector masks along it, add a few branch
 * stubs and random filler pipes, sprinkle firewalls, then randomize rotations.
 */
export function generatePuzzle(w: number, h: number, firewalls: number, rng: Rng): Puzzle {
  for (let attempt = 0; attempt < 200; attempt++) {
    const p = tryGenerate(w, h, firewalls, rng);
    if (p) return p;
  }
  // Fallback: a trivial straight line (should never be needed).
  return tryGenerate(w, h, 0, rng)!;
}

function tryGenerate(w: number, h: number, firewalls: number, rng: Rng): Puzzle | null {
  const cells: Cell[] = Array.from({ length: w * h }, () => ({
    kind: "empty" as CellKind,
    mask: 0,
    solvedMask: 0,
    rot: 0,
    targetRot: 0,
    filled: false,
    fixed: false,
  }));
  const idx = (x: number, y: number) => y * w + x;

  const sourceY = rng.int(0, h - 1);
  const sinkY = rng.int(0, h - 1);
  const source = idx(0, sourceY);
  const sink = idx(w - 1, sinkY);

  // Place firewalls first (never on source/sink rows' entry columns).
  const blocked = new Set<number>();
  let placed = 0;
  for (let i = 0; i < firewalls * 6 && placed < firewalls; i++) {
    const x = rng.int(1, w - 2);
    const y = rng.int(0, h - 1);
    const id = idx(x, y);
    if (id === source || id === sink) continue;
    if (blocked.has(id)) continue;
    blocked.add(id);
    placed++;
  }

  // Randomized DFS to carve a path from source to sink.
  const path = carvePath(w, h, source, sink, blocked, rng);
  if (!path) return null;

  // Assign connector masks along the path.
  const onPath = new Set(path);
  for (let i = 0; i < path.length; i++) {
    const cur = path[i];
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    let mask = 0;
    if (i > 0) mask |= sideBetween(cur, path[i - 1], w);
    if (i < path.length - 1) mask |= sideBetween(cur, path[i + 1], w);
    const c = cells[cur];
    c.kind = "pipe";
    c.mask = mask;
    c.solvedMask = mask;
    void cx;
    void cy;
  }

  // Source & sink open toward the board edge too (cosmetic tail into the node).
  const sourceSide = sideBetween(source, path[1], w);
  const sinkSide = sideBetween(sink, path[path.length - 2], w);
  const srcC = cells[source];
  srcC.kind = "source";
  srcC.mask = sourceSide;
  srcC.solvedMask = sourceSide;
  srcC.fixed = true;
  srcC.filled = true;
  const sinkC = cells[sink];
  sinkC.kind = "sink";
  sinkC.mask = sinkSide;
  sinkC.solvedMask = sinkSide;
  sinkC.fixed = true;

  // Firewalls.
  for (const id of blocked) {
    if (onPath.has(id)) continue;
    cells[id].kind = "firewall";
    cells[id].fixed = true;
  }

  // Filler pipes on some empty cells: random shapes, so the board isn't obviously the path.
  const shapes = [N | E, N | S, E | S, S | W, N | W, E | W, N | E | S, N | E | W, N | E | S | W];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.kind !== "empty") continue;
    if (rng.chance(0.55)) {
      const m = rng.pick(shapes);
      c.kind = "pipe";
      c.mask = m;
      c.solvedMask = m;
    }
  }

  // Randomize rotations of all non-fixed pipes; ensure the puzzle isn't already solved.
  const p: Puzzle = { w, h, cells, source, sink, sourceSide, sinkSide };
  scramble(p, rng);
  return p;
}

function scramble(p: Puzzle, rng: Rng): void {
  let tries = 0;
  do {
    for (const c of p.cells) {
      if (c.fixed || c.kind !== "pipe") continue;
      const r = rng.int(0, 3);
      c.mask = rotateMaskN(c.solvedMask, r);
      c.rot = r;
      c.targetRot = r;
    }
    tries++;
  } while (computeFlow(p) && tries < 40);
  computeFlow(p);
}

function rotateMaskN(mask: number, times: number): number {
  let m = mask;
  for (let i = 0; i < times; i++) m = ((m << 1) | (m >> 3)) & 0b1111;
  return m;
}

function sideBetween(from: number, to: number, w: number): number {
  const fx = from % w,
    fy = Math.floor(from / w);
  const tx = to % w,
    ty = Math.floor(to / w);
  if (tx === fx + 1) return E;
  if (tx === fx - 1) return W;
  if (ty === fy + 1) return S;
  return N;
}

function carvePath(
  w: number,
  h: number,
  source: number,
  sink: number,
  blocked: Set<number>,
  rng: Rng,
): number[] | null {
  const idx = (x: number, y: number) => y * w + x;
  const visited = new Set<number>([source]);
  const path: number[] = [source];

  const target = sink;
  // Greedy-random DFS biased toward the sink.
  function dfs(cur: number): boolean {
    if (cur === target) return true;
    const cx = cur % w,
      cy = Math.floor(cur / w);
    const tx = target % w,
      ty = Math.floor(target / w);
    const neighbors: number[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const id = idx(nx, ny);
      if (visited.has(id) || blocked.has(id)) continue;
      neighbors.push(id);
    }
    // Bias: sort so cells closer to target (with jitter) come first.
    neighbors.sort((a, b) => {
      const da = Math.abs((a % w) - tx) + Math.abs(Math.floor(a / w) - ty) + rng.range(-1.2, 1.2);
      const db = Math.abs((b % w) - tx) + Math.abs(Math.floor(b / w) - ty) + rng.range(-1.2, 1.2);
      return da - db;
    });
    for (const n of neighbors) {
      visited.add(n);
      path.push(n);
      if (dfs(n)) return true;
      path.pop();
      visited.delete(n);
    }
    return false;
  }

  if (!dfs(source)) return null;
  // Require a path with at least a couple of turns for interest.
  return path.length >= 3 ? path : null;
}
