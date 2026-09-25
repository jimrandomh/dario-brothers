// Number formatting. Coin counts go from 1 to ~10^45 over the course of the game.

const NAMES = [
  "",
  "thousand",
  "million",
  "billion",
  "trillion",
  "quadrillion",
  "quintillion",
  "sextillion",
  "septillion",
  "octillion",
  "nonillion",
  "decillion",
  "undecillion",
  "duodecillion",
  "tredecillion",
  "quattuordecillion",
  "quindecillion",
];

const SHORT = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};

export function superscript(n: number | string): string {
  return String(n)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
}

/** 1234567 -> "1,234,567" */
export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

/** "3.4 × 10³⁴" */
export function fmtSci(n: number, digits = 2): string {
  if (n === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const mant = n / Math.pow(10, exp);
  return `${mant.toFixed(digits)} × 10${superscript(exp)}`;
}

/**
 * Human-readable large number: exact with commas below a million,
 * then "12.3 million" ... "4.56 quindecillion", then scientific.
 * With `fixed`, trailing zeros are kept ("12.0 million") so a changing value
 * doesn't jitter between lengths.
 */
export function fmtBig(n: number, digits = 3, fixed = false): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const a = Math.abs(n);
  if (a < 1e6) return fmtInt(n);
  let tier = Math.floor(Math.log10(a) / 3);
  // 999.96 million rounds to "1000 million"; show it as "1.00 billion" instead.
  if (Math.abs(Number(toSig(n / Math.pow(10, tier * 3), digits))) >= 1000) tier++;
  if (tier < NAMES.length) {
    const scaled = n / Math.pow(10, tier * 3);
    return `${toSig(scaled, digits, fixed)} ${NAMES[tier]}`;
  }
  return fmtSci(n, digits - 1);
}

/** Compact: 1.2K, 3.4M, 5.6B ... 1.2e45 */
export function fmtShort(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const a = Math.abs(n);
  if (a < 1000) return a < 10 && a % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
  const tier = Math.floor(Math.log10(a) / 3);
  if (tier < SHORT.length) return toSig(n / Math.pow(10, tier * 3), digits) + SHORT[tier];
  return n.toExponential(digits - 1).replace("e+", "e");
}

const SI = ["", "k", "M", "G", "T", "P", "E", "Z", "Y", "R", "Q"];

/** SI units: fmtSI(3.2e15, "W") -> "3.2 PW" */
export function fmtSI(n: number, unit: string, digits = 3): string {
  const a = Math.abs(n);
  if (a < 1000) return `${toSig(n, digits)} ${unit}`;
  const tier = Math.floor(Math.log10(a) / 3);
  if (tier < SI.length) return `${toSig(n / Math.pow(10, tier * 3), digits)} ${SI[tier]}${unit}`;
  return `${fmtSci(n, digits - 1)} ${unit}`;
}

export function fmtCoins(n: number): string {
  return fmtBig(n);
}

/** Duration in world time: "4 min", "3.2 hours", "12 days", "2.1 years" */
export function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${toSig(s, 2)} s`;
  const m = s / 60;
  if (m < 60) return `${toSig(m, 2)} min`;
  const h = m / 60;
  if (h < 48) return `${toSig(h, 2)} hours`;
  const d = h / 24;
  if (d < 60) return `${toSig(d, 2)} days`;
  const mo = d / 30.44;
  if (mo < 24) return `${toSig(mo, 2)} months`;
  return `${toSig(d / 365.25, 3)} years`;
}

function toSig(n: number, digits: number, keepZeros = false): string {
  // Significant digits, but never exponent notation; trailing zeros trimmed unless asked.
  const a = Math.abs(n);
  const intDigits = a < 1 ? 1 : Math.floor(Math.log10(a)) + 1;
  const decimals = Math.max(0, digits - intDigits);
  const s = n.toFixed(decimals);
  return keepZeros ? s : Number(s).toString();
}
