// Procedural pixel art. Everything is drawn once into small cached canvases.

import { Rng } from "../../core/rng";

export const TS = 16;

const PALETTE: Record<string, string> = {
  R: "#d83a20", // cap / shirt
  r: "#8e1c0c",
  S: "#f8b878", // skin
  H: "#6b3a10", // hair / shoes
  M: "#2c1606", // mustache
  B: "#2f5be0", // overalls
  b: "#1a3290",
  Y: "#f8d830",
  K: "#101010",
  W: "#ffffff",
  // bug
  P: "#6a2c9a",
  p: "#2e0f48",
  L: "#c68cf0",
  A: "#1a0a24",
  E: "#ffffff",
};

function fromMap(rows: string[], palette = PALETTE): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0].length;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = palette[rows[y][x]];
      if (col) {
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function flipH(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext("2d")!;
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

// ---------------------------------------------------------------- Dario

const HEAD = [
  "................",
  ".....rRRRRr.....",
  "....rRRRYRRRr...",
  "...rRRRRRRRRRRR.",
  "...HHSSSSSS.....",
  "..HHSSSSKSSK....",
  "..HSSSSSKSSKSS..",
  "..HSSSSSSSSSSSS.",
  "...SSSMMMMMMS...",
  "....SSSSSSSS....",
];

const DARIO_FRAMES: Record<string, string[]> = {
  stand: [
    ...HEAD,
    "...RRBRRRRBRR...",
    "..RRRBBBBBBRRR..",
    "..SSRBYBBYBRSS..",
    "....BBBBBBBB....",
    "....HHHH.HHHH...",
    "...HHHHH.HHHHH..",
  ],
  run1: [
    ...HEAD,
    "...RRBRRRRBRR...",
    "..RRRBBBBBBRRSS.",
    ".SSRBYBBYBBB.SS.",
    ".SS.BBBBBBBBB...",
    "...HHHB...BHHH..",
    "..HHHH.....HHH..",
  ],
  run2: [
    ...HEAD,
    "...RRBRRRRBRR...",
    "...RRBBBBBBRR...",
    "...SSBYBBYBSS...",
    "....BBBBBBBB....",
    ".....BBHHHH.....",
    ".....HHHHH......",
  ],
  run3: [
    ...HEAD,
    "...RRBRRRRBRR...",
    ".SSRRBBBBBBRR...",
    ".SS.BYBBYBBRSS..",
    "....BBBBBBBBB...",
    "...BBB...HHHH...",
    "..HHHH....HHH...",
  ],
  jump: [
    "..............SS",
    ".....rRRRRr...SS",
    "....rRRRYRRRr.R.",
    "...rRRRRRRRRRRR.",
    "...HHSSSSSS..R..",
    "..HHSSSSKSSK.R..",
    "..HSSSSSKSSKSR..",
    "..HSSSSSSSSSSR..",
    "...SSSMMMMMMR...",
    "....SSSSSSSR....",
    "...RRBRRRRBRR...",
    "SSRRRBBBBBBRR...",
    "SS..BYBBYBB.....",
    "...BBBBBBBBB....",
    "..HHHB....BHH...",
    ".HHHH......HHH..",
  ],
  dead: [
    "................",
    "..SS.rRRRRr.SS..",
    "..SSrRRRYRRrSS..",
    "...RRRRRRRRRR...",
    "...HSSSSSSSSH...",
    "..HHSKSSSSKSHH..",
    "..HSSKSSSSKSSH..",
    "...SSSSSSSSSS...",
    "...SMMMMMMMMS...",
    "....SSSKKSSS....",
    "..RRRBRRRRBRRR..",
    "..RRRBBBBBBRRR..",
    "....BYBBBBYB....",
    "....BBBBBBBB....",
    "...HHHH..HHHH...",
    "..HHHHH..HHHHH..",
  ],
};

export type DarioFrame = keyof typeof DARIO_FRAMES;

// ---------------------------------------------------------------- Bug (the enemy)

const BUG_TOP = [
  "................",
  "................",
  "................",
  "......pppp......",
  "....ppPPPPpp....",
  "...pPPLLPPPPp...",
  "..pPPLLPPPPPPp..",
  "..pPPPPPPPPPPp..",
  ".EEKpPPPPPPPPPp.",
  ".EKKpPPPPPPPPPp.",
  ".EEEpPPPPPPPPPp.",
  "..ppppppppppppp.",
];

const BUG_FRAMES: Record<string, string[]> = {
  walk1: [...BUG_TOP, "...A..A...A..A..", "..A..A...A..A...", "..A..A...A..A...", "................"],
  walk2: [...BUG_TOP, "....A..A...A..A.", "....A..A...A..A.", "...A..A...A..A..", "................"],
  flat: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "....pppppppp....",
    "..ppPPLLPPPPpp..",
    ".pEKpPPPPPPPPPp.",
    ".ppppppppppppppp",
    "..A.A.A..A.A.A..",
  ],
};

// ---------------------------------------------------------------- tiles

function drawGroundTile(top: boolean, seed: number): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  const r = new Rng(seed);
  g.fillStyle = "#a0521c";
  g.fillRect(0, 0, TS, TS);
  // speckles
  for (let i = 0; i < 14; i++) {
    g.fillStyle = r.chance(0.5) ? "#7a3a10" : "#c06a2c";
    g.fillRect(r.int(0, 15), r.int(top ? 5 : 0, 15), r.chance(0.3) ? 2 : 1, 1);
  }
  if (top) {
    g.fillStyle = "#3aa83a";
    g.fillRect(0, 0, TS, 4);
    g.fillStyle = "#8ee05a";
    g.fillRect(0, 0, TS, 1);
    g.fillStyle = "#1f7a24";
    for (let x = 0; x < TS; x++) {
      const d = (x * 7 + seed) % 5 < 2 ? 5 : 4;
      g.fillRect(x, 4, 1, d - 4 + 1);
    }
  }
  return c;
}

function drawBrick(): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  g.fillStyle = "#3c1c08";
  g.fillRect(0, 0, TS, TS);
  g.fillStyle = "#b85820";
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 4 : 0;
    for (let bx = -8; bx < TS; bx += 8) {
      const x0 = bx + off;
      g.fillStyle = "#b85820";
      g.fillRect(x0, row * 4, 7, 3);
      g.fillStyle = "#e8904c";
      g.fillRect(x0, row * 4, 7, 1);
    }
  }
  return c;
}

function drawQBlock(phase: number): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  const body = ["#f8b030", "#f0a020", "#d88a10"][phase];
  g.fillStyle = "#5a2e04";
  g.fillRect(0, 0, TS, TS);
  g.fillStyle = body;
  g.fillRect(1, 1, 14, 14);
  g.fillStyle = "#ffe08a";
  g.fillRect(1, 1, 14, 1);
  g.fillRect(1, 1, 1, 14);
  g.fillStyle = "#a05a08";
  g.fillRect(1, 14, 14, 1);
  g.fillRect(14, 1, 1, 14);
  // rivets
  g.fillStyle = "#5a2e04";
  [
    [3, 3],
    [12, 3],
    [3, 12],
    [12, 12],
  ].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
  // question mark
  const q = ["..###..", ".#...#.", ".....#.", "....#..", "...#...", ".......", "...#..."];
  q.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "#") {
        g.fillStyle = "#5a2e04";
        g.fillRect(4 + x + 1, 4 + y + 1, 1, 1);
        g.fillStyle = "#fff4d0";
        g.fillRect(4 + x, 4 + y, 1, 1);
      }
    }
  });
  return c;
}

function drawUsed(): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a1e08";
  g.fillRect(0, 0, TS, TS);
  g.fillStyle = "#8a5a30";
  g.fillRect(1, 1, 14, 14);
  g.fillStyle = "#3a1e08";
  [
    [3, 3],
    [12, 3],
    [3, 12],
    [12, 12],
  ].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
  return c;
}

function drawSolid(): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  g.fillStyle = "#b8783c";
  g.fillRect(0, 0, TS, TS);
  g.fillStyle = "#f0c080";
  g.fillRect(0, 0, TS, 2);
  g.fillRect(0, 0, 2, TS);
  g.fillStyle = "#6a3a14";
  g.fillRect(0, 14, TS, 2);
  g.fillRect(14, 0, 2, TS);
  g.fillStyle = "#d09050";
  g.fillRect(4, 4, 8, 8);
  return c;
}

function drawPipe(part: "TL" | "TR" | "L" | "R"): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  const top = part === "TL" || part === "TR";
  const left = part === "TL" || part === "L";
  const OUT = "#0b3a0b";
  const DARK = "#1a7a1a";
  const MID = "#34b034";
  const LIGHT = "#9cf06a";
  // lip is full width; body is inset 2px on the outer side
  const x0 = top ? 0 : left ? 2 : 0;
  const x1 = top ? TS : left ? TS : TS - 2;
  g.fillStyle = OUT;
  g.fillRect(x0, 0, x1 - x0, TS);
  g.fillStyle = MID;
  g.fillRect(x0 + (left ? 1 : 0), top ? 1 : 0, x1 - x0 - 1, top ? TS - 2 : TS);
  if (left) {
    g.fillStyle = LIGHT;
    g.fillRect(x0 + 3, top ? 2 : 0, 2, top ? TS - 4 : TS);
    g.fillStyle = "#ccff9a";
    g.fillRect(x0 + 6, top ? 2 : 0, 1, top ? TS - 4 : TS);
  } else {
    g.fillStyle = DARK;
    g.fillRect(x1 - 6, top ? 2 : 0, 4, top ? TS - 4 : TS);
    g.fillStyle = OUT;
    g.fillRect(x1 - 1, 0, 1, TS);
  }
  if (top) {
    g.fillStyle = OUT;
    g.fillRect(0, TS - 1, TS, 1);
    g.fillRect(0, 0, TS, 1);
  }
  return c;
}

// ---------------------------------------------------------------- coins

function drawCoinFrame(width: number): HTMLCanvasElement {
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  const h = 12;
  const top = 2;
  const cx = 8;
  for (let y = 0; y < h; y++) {
    const t = (y + 0.5 - h / 2) / (h / 2);
    const hw = Math.max(0.5, (width / 2) * Math.sqrt(Math.max(0, 1 - t * t * 0.85)));
    const xa = Math.round(cx - hw);
    const xb = Math.round(cx + hw);
    g.fillStyle = "#8a5a00";
    g.fillRect(xa, top + y, xb - xa, 1);
    if (xb - xa > 2) {
      g.fillStyle = y > h - 4 ? "#e0a810" : "#f8d830";
      g.fillRect(xa + 1, top + y, xb - xa - 2, 1);
    }
    if (width >= 6 && y > 1 && y < h - 2) {
      g.fillStyle = "#fff6c0";
      g.fillRect(xa + 2, top + y, 1, 1);
      if (width >= 9 && y > 2 && y < h - 3) {
        g.fillStyle = "#c08000";
        g.fillRect(cx, top + y, 1, 1);
      }
    }
  }
  return c;
}

/** Glitch coin frames: coin silhouette filled with missing-texture checker + noise. */
function drawGlitchFrame(seed: number): HTMLCanvasElement {
  const base = drawCoinFrame(10);
  const bg = base.getContext("2d")!.getImageData(0, 0, TS, TS);
  const c = makeCanvas(TS, TS);
  const g = c.getContext("2d")!;
  const r = new Rng(seed);
  const img = g.createImageData(TS, TS);
  for (let y = 0; y < TS; y++) {
    const shift = r.chance(0.12) ? r.int(-3, 3) : 0;
    for (let x = 0; x < TS; x++) {
      const sx = Math.min(TS - 1, Math.max(0, x - shift));
      const a = bg.data[(y * TS + sx) * 4 + 3];
      if (!a) continue;
      const checker = ((x >> 1) + (y >> 1)) % 2 === 0;
      let rr = checker ? 255 : 0;
      let gg = 0;
      let bb = checker ? 220 : 0;
      if (r.chance(0.1)) {
        rr = r.int(0, 255);
        gg = r.int(0, 255);
        bb = r.int(0, 255);
      }
      const i = (y * TS + x) * 4;
      img.data[i] = rr;
      img.data[i + 1] = gg;
      img.data[i + 2] = bb;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- background decor

function blob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  for (let y = -r; y <= r; y++) {
    const hw = Math.round(Math.sqrt(r * r - y * y));
    g.fillRect(cx - hw, cy + y, hw * 2, 1);
  }
}

function drawCloud(size: number, fill: string, shade: string, outline: string): HTMLCanvasElement {
  const w = 16 * size + 16;
  const c = makeCanvas(w, 28);
  const g = c.getContext("2d")!;
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < size; i++) puffs.push([16 + i * 16, 14, 9]);
  puffs.push([8, 18, 6], [w - 8, 18, 6]);
  for (let i = 0; i < size - 1; i++) puffs.push([24 + i * 16, 9, 7]);
  g.fillStyle = outline;
  puffs.forEach(([x, y, r]) => blob(g, x, y, r + 1));
  g.fillStyle = shade;
  puffs.forEach(([x, y, r]) => blob(g, x, y, r));
  g.fillStyle = fill;
  puffs.forEach(([x, y, r]) => blob(g, x, y - 2, r - 1));
  g.clearRect(0, 24, w, 4);
  g.fillStyle = outline;
  g.fillRect(4, 23, w - 8, 1);
  return c;
}

function drawHill(size: number): HTMLCanvasElement {
  const h = 16 + size * 16;
  const w = h * 2 + 8;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d")!;
  g.fillStyle = "#0e5a1a";
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const hw = Math.round((w / 2) * Math.sqrt(t) * 0.98) + 1;
    g.fillRect(w / 2 - hw, y, hw * 2, 1);
  }
  g.fillStyle = "#2c9a36";
  for (let y = 1; y < h; y++) {
    const t = y / h;
    const hw = Math.round((w / 2) * Math.sqrt(t) * 0.98) - 1;
    if (hw > 0) g.fillRect(w / 2 - hw, y, hw * 2, 1);
  }
  g.fillStyle = "#0e5a1a";
  const spots = size + 1;
  for (let i = 0; i < spots; i++) {
    const sx = w / 2 + (i - spots / 2 + 0.5) * 12;
    const sy = h * 0.55 + (i % 2) * 8;
    g.fillRect(sx - 1, sy, 2, 5);
    g.fillRect(sx - 2, sy + 1, 4, 3);
  }
  return c;
}

// ---------------------------------------------------------------- flag & castle

function drawFlag(): HTMLCanvasElement {
  const c = makeCanvas(16, 16);
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f4f4";
  for (let y = 0; y < 14; y++) {
    const w = Math.round(16 - Math.abs(y - 7) * 1.4);
    g.fillRect(16 - w, y + 1, w, 1);
  }
  // coin emblem
  g.fillStyle = "#8a5a00";
  blob(g, 10, 8, 4);
  g.fillStyle = "#f8d830";
  blob(g, 10, 8, 3);
  return c;
}

function drawCastle(): HTMLCanvasElement {
  const w = 80;
  const h = 80;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d")!;
  const brick = drawBrick();
  // lower body 5 wide x 2 tall, tower 3 wide x 2 tall, crenellations
  for (let x = 0; x < 5; x++) for (let y = 3; y < 5; y++) g.drawImage(brick, x * 16, y * 16);
  for (let x = 1; x < 4; x++) for (let y = 1; y < 3; y++) g.drawImage(brick, x * 16, y * 16);
  g.fillStyle = "#3c1c08";
  for (let x = 0; x < 5; x++) {
    g.drawImage(brick, x * 16, 40, 16, 8, x * 16, 40, 16, 8);
  }
  // crenellations
  for (let x = 0; x < 5; x++) {
    g.clearRect(x * 16 + 5, 48, 6, 0);
  }
  for (let i = 0; i < 5; i++) g.drawImage(brick, 0, 0, 8, 8, i * 16 + 4, 40, 8, 8);
  for (let i = 0; i < 3; i++) g.drawImage(brick, 0, 0, 8, 8, 16 + i * 16 + 4, 8, 8, 8);
  g.clearRect(0, 40, 80, 8);
  for (let i = 0; i < 5; i++) g.drawImage(brick, 0, 0, 8, 8, i * 16 + 4, 40, 8, 8);
  g.clearRect(0, 0, 80, 16);
  for (let i = 0; i < 3; i++) g.drawImage(brick, 0, 0, 8, 8, 16 + i * 16 + 4, 8, 8, 8);
  // door + windows
  g.fillStyle = "#000";
  g.fillRect(32, 56, 16, 24);
  blob(g, 40, 56, 8);
  g.fillRect(28, 24, 6, 10);
  g.fillRect(46, 24, 6, 10);
  return c;
}

// ---------------------------------------------------------------- sheet

export interface Sheet {
  dario: Record<string, { r: HTMLCanvasElement; l: HTMLCanvasElement }>;
  bug: Record<string, HTMLCanvasElement>;
  ground: HTMLCanvasElement[];
  groundTop: HTMLCanvasElement[];
  brick: HTMLCanvasElement;
  qblock: HTMLCanvasElement[];
  used: HTMLCanvasElement;
  solid: HTMLCanvasElement;
  pipe: Record<"TL" | "TR" | "L" | "R", HTMLCanvasElement>;
  coin: HTMLCanvasElement[];
  glitch: HTMLCanvasElement[];
  clouds: HTMLCanvasElement[];
  bushes: HTMLCanvasElement[];
  hills: HTMLCanvasElement[];
  flag: HTMLCanvasElement;
  castle: HTMLCanvasElement;
}

let sheet: Sheet | null = null;

export function getSheet(): Sheet {
  if (sheet) return sheet;
  const dario: Sheet["dario"] = {};
  for (const [k, rows] of Object.entries(DARIO_FRAMES)) {
    const r = fromMap(rows);
    dario[k] = { r, l: flipH(r) };
  }
  const bug: Sheet["bug"] = {};
  for (const [k, rows] of Object.entries(BUG_FRAMES)) bug[k] = fromMap(rows);
  sheet = {
    dario,
    bug,
    ground: [0, 1, 2, 3].map((i) => drawGroundTile(false, 11 + i * 7)),
    groundTop: [0, 1, 2, 3].map((i) => drawGroundTile(true, 5 + i * 13)),
    brick: drawBrick(),
    qblock: [0, 1, 2].map(drawQBlock),
    used: drawUsed(),
    solid: drawSolid(),
    pipe: { TL: drawPipe("TL"), TR: drawPipe("TR"), L: drawPipe("L"), R: drawPipe("R") },
    coin: [10, 7, 2, 7].map(drawCoinFrame),
    glitch: Array.from({ length: 8 }, (_, i) => drawGlitchFrame(i * 977 + 3)),
    clouds: [1, 2, 3].map((s) => drawCloud(s, "#ffffff", "#bfe0ff", "#1c2c6a")),
    bushes: [1, 2, 3].map((s) => drawCloud(s, "#5ad85a", "#2c9a36", "#0e5a1a")),
    hills: [1, 2].map(drawHill),
    flag: drawFlag(),
    castle: drawCastle(),
  };
  return sheet;
}
