// Visual themes. Levels darken as the anomalies spread: day → dusk → night → underground →
// corrupted. Coin-fill mode is always daytime; bonus rooms are always underground.

export type ThemeId = "day" | "dusk" | "night" | "underground" | "corrupt";

export interface Theme {
  id: ThemeId;
  skyTop: string;
  skyBottom: string;
  /** Grass on top of the ground: [blade, highlight, root shadow]; null for bare stone. */
  grass: [string, string, string] | null;
  /** Ground body: [base, dark speckle, light speckle]. */
  dirt: [string, string, string];
  /** Bricks: [mortar, body, highlight]. */
  brick: [string, string, string];
  /** Stair blocks: [base, light bevel, dark bevel, inset]. */
  solid: [string, string, string, string];
  /** [fill, shade, outline]; null = no clouds. */
  clouds: [string, string, string] | null;
  /** [outline, body]; null = no hills. */
  hills: [string, string] | null;
  /** [fill, shade, outline]; null = no bushes. */
  bushes: [string, string, string] | null;
  stars: boolean;
  moon: boolean;
}

export const THEMES: Record<ThemeId, Theme> = {
  day: {
    id: "day",
    skyTop: "#5a8cff",
    skyBottom: "#8fb8ff",
    grass: ["#3aa83a", "#8ee05a", "#1f7a24"],
    dirt: ["#a0521c", "#7a3a10", "#c06a2c"],
    brick: ["#3c1c08", "#b85820", "#e8904c"],
    solid: ["#b8783c", "#f0c080", "#6a3a14", "#d09050"],
    clouds: ["#ffffff", "#bfe0ff", "#1c2c6a"],
    hills: ["#0e5a1a", "#2c9a36"],
    bushes: ["#5ad85a", "#2c9a36", "#0e5a1a"],
    stars: false,
    moon: false,
  },
  dusk: {
    id: "dusk",
    skyTop: "#3b2a6a",
    skyBottom: "#f29a64",
    grass: ["#3a8a3a", "#9ad06a", "#1f5a24"],
    dirt: ["#8a4a24", "#5a2a10", "#a8643a"],
    brick: ["#2c1406", "#a04c20", "#d88048"],
    solid: ["#a86a38", "#e0a870", "#5a3010", "#c08048"],
    clouds: ["#ffd6bc", "#e8988a", "#5a2a4a"],
    hills: ["#1a3a2a", "#3a6a3a"],
    bushes: ["#4ab04a", "#2a7a36", "#123a1a"],
    stars: false,
    moon: false,
  },
  night: {
    id: "night",
    skyTop: "#050817",
    skyBottom: "#1c2658",
    grass: ["#2a6a3a", "#5aa06a", "#123a1a"],
    dirt: ["#5a3a2a", "#3a2418", "#7a5238"],
    brick: ["#141428", "#5a5a8a", "#8a8ab8"],
    solid: ["#6a6a8a", "#a0a0c8", "#34344a", "#7a7aa0"],
    clouds: ["#4a5a8a", "#34406a", "#10142a"],
    hills: ["#0a1a20", "#1a3a3a"],
    bushes: ["#2a5a4a", "#1a3a30", "#0a1a14"],
    stars: true,
    moon: true,
  },
  underground: {
    id: "underground",
    skyTop: "#05060c",
    skyBottom: "#0d1224",
    grass: null,
    dirt: ["#3a4a6a", "#26304a", "#56688a"],
    brick: ["#0e1428", "#2c5a9a", "#5a8ad0"],
    solid: ["#4a5a7a", "#7a8aaa", "#232c40", "#5a6a8a"],
    clouds: null,
    hills: null,
    bushes: null,
    stars: false,
    moon: false,
  },
  corrupt: {
    id: "corrupt",
    skyTop: "#12041a",
    skyBottom: "#3a0a40",
    grass: ["#6a3a8a", "#b07ad0", "#3a1a4a"],
    dirt: ["#4a2a4a", "#2a1a2a", "#6a4a6a"],
    brick: ["#1a0a1a", "#7a3a6a", "#b06aa0"],
    solid: ["#6a4a6a", "#a07aa0", "#2a1a2a", "#7a5a7a"],
    clouds: ["#6a3a6a", "#4a2a4a", "#1a0a1a"],
    hills: ["#1a0a20", "#3a1a3a"],
    bushes: ["#5a2a6a", "#3a1a4a", "#1a0a20"],
    stars: true,
    moon: false,
  },
};

export function themeForLevel(mode: "normal" | "coinfill", n: number): ThemeId {
  if (mode === "coinfill") return "day";
  if (n <= 2) return "day";
  if (n === 3) return "dusk";
  if (n === 4) return "night";
  if (n === 5) return "underground";
  return "corrupt";
}
