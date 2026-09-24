// Solar-system view: Sun, orbits, planets, missions in flight, and the Dyson swarm.
// Orbits use compressed (log) radii and a tilted-ellipse projection so everything fits.

import { BODIES, BODY, type BodyId, type Derived, type SpaceModel } from "./model";
import { Rng } from "../../core/rng";

const J2000 = Date.UTC(2000, 0, 1, 12);
const YEAR_MS = 365.25 * 86400000;
const TILT = 0.58;
const GOLD = "#ffd23f";

export type Target = BodyId | "earth" | "sun";

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
  ph: number;
}

interface SwarmP {
  /** Orbit radius as a fraction between the inner and outer swarm radius. */
  f: number;
  th: number;
  w: number;
  ratio: number;
  rot: number;
  ph: number;
  glint: number;
}

interface Rock {
  au: number;
  ph: number;
  period: number;
  size: number;
}

interface Pt {
  x: number;
  y: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function earthColor(conv: number): string {
  if (conv < 0.55) return mix("#2f74d6", "#7f8791", conv / 0.55);
  return mix("#7f8791", "#e0b33c", (conv - 0.55) / 0.45);
}

export class SolarRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private stars: Star[] = [];
  private swarm: SwarmP[] = [];
  private rocks: Rock[] = [];
  private phases: Record<string, number> = {};
  private hitboxes: { id: Target; x: number; y: number; r: number }[] = [];
  hover: Target | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const rng = new Rng(2029);
    for (let i = 0; i < 260; i++) {
      this.stars.push({ x: rng.next(), y: rng.next(), r: rng.chance(0.08) ? 1.4 : 0.8, tw: rng.range(0.5, 2), ph: rng.range(0, 6.28) });
    }
    for (let i = 0; i < 1800; i++) {
      this.swarm.push({
        f: Math.pow(rng.next(), 0.8),
        th: rng.range(0, Math.PI * 2),
        w: rng.range(0.15, 0.6) * (rng.chance(0.5) ? 1 : -1),
        ratio: rng.range(0.08, 1),
        rot: rng.range(0, Math.PI),
        ph: rng.range(0, Math.PI * 2),
        glint: rng.range(1.5, 4),
      });
    }
    for (let i = 0; i < 260; i++) {
      const au = rng.range(2.15, 3.3);
      this.rocks.push({ au, ph: rng.range(0, Math.PI * 2), period: Math.pow(au, 1.5), size: rng.chance(0.15) ? 1.4 : 0.9 });
    }
    for (const b of BODIES) this.phases[b.id] = rng.range(0, Math.PI * 2);
    this.phases.earth = 1.75;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // ---------- geometry ----------

  private get cx(): number {
    return this.w / 2;
  }
  private get cy(): number {
    return this.h / 2 + Math.min(20, this.h * 0.03);
  }
  private get maxR(): number {
    return Math.max(60, Math.min(this.w / 2 - 18, (this.h / 2 - 22) / TILT));
  }
  private get sunR(): number {
    return Math.max(6, this.maxR * 0.045);
  }
  private get scale(): number {
    return Math.max(0.6, Math.min(2.4, this.maxR / 300));
  }

  orbitR(au: number): number {
    const frac = Math.log(1 + au / 0.2) / Math.log(1 + 30.1 / 0.2);
    const inner = this.sunR * 1.2;
    return inner + (this.maxR - inner) * frac;
  }

  private swarmR(): [number, number] {
    return [this.sunR * 1.45, this.orbitR(0.39) * 0.74];
  }

  private angle(id: string, period: number, absMs: number): number {
    const years = (absMs - J2000) / YEAR_MS;
    return this.phases[id] + (Math.PI * 2 * years) / period;
  }

  private project(r: number, a: number): Pt {
    return { x: this.cx + r * Math.cos(a), y: this.cy + r * Math.sin(a) * TILT };
  }

  /** Screen position of a body at an absolute world time. */
  pos(id: Target, absMs: number): Pt {
    if (id === "sun") return { x: this.cx, y: this.cy };
    if (id === "earth") return this.project(this.orbitR(1), this.angle("earth", 1, absMs));
    if (id === "moon") {
      const e = this.pos("earth", absMs);
      const a = this.angle("moon", BODY.moon.period, absMs);
      const r = 9 * this.scale;
      return { x: e.x + r * Math.cos(a), y: e.y + r * Math.sin(a) * TILT };
    }
    if (id === "belt") return this.project(this.orbitR(2.7), this.angle("belt", 4.6, absMs));
    const b = BODY[id];
    return this.project(this.orbitR(b.au), this.angle(id, b.period, absMs));
  }

  hit(x: number, y: number): Target | null {
    let best: Target | null = null;
    let bestD = Infinity;
    for (const h of this.hitboxes) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r + 7 && d < bestD) {
        best = h.id;
        bestD = d;
      }
    }
    if (!best) {
      // The belt is a ring, not a point.
      const dx = x - this.cx;
      const dy = (y - this.cy) / TILT;
      const r = Math.hypot(dx, dy);
      if (r > this.orbitR(2.15) && r < this.orbitR(3.3)) best = "belt";
    }
    return best;
  }

  // ---------- drawing ----------

  draw(m: SpaceModel, d: Derived, absMs: number, realT: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#03050a";
    ctx.fillRect(0, 0, this.w, this.h);
    this.hitboxes = [];

    const c = m.coverage;
    const dim = 1 - 0.85 * Math.pow(c, 0.8);

    // stars
    for (const s of this.stars) {
      const a = (0.35 + 0.35 * Math.sin(realT * s.tw + s.ph)) * (0.6 + 0.4 * (1 - dim));
      ctx.fillStyle = `rgba(210,220,255,${a.toFixed(3)})`;
      ctx.fillRect(s.x * this.w, s.y * this.h, s.r, s.r);
    }

    // orbits
    ctx.lineWidth = 1;
    const orbit = (au: number, style: string) => {
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.ellipse(this.cx, this.cy, this.orbitR(au), this.orbitR(au) * TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
    };
    orbit(1, "rgba(120,170,255,0.16)");
    for (const b of BODIES) {
      if (b.id === "moon" || b.id === "belt") continue;
      const claimed = !!m.claimed[b.id];
      const enroute = m.missions.some((x) => x.body === b.id);
      orbit(b.au, claimed ? "rgba(255,210,63,0.22)" : enroute ? "rgba(127,227,255,0.22)" : "rgba(255,255,255,0.07)");
    }

    // asteroid belt
    const beltGold = !!m.claimed.belt;
    for (const r of this.rocks) {
      const a = r.ph + (Math.PI * 2 * (absMs - J2000)) / YEAR_MS / r.period;
      const p = this.project(this.orbitR(r.au), a);
      ctx.fillStyle = beltGold ? "rgba(255,210,63,0.75)" : "rgba(150,140,125,0.55)";
      ctx.fillRect(p.x, p.y, r.size, r.size);
    }

    // Split bodies into behind-the-sun and in-front for a little depth.
    type Drawn = { id: Target; p: Pt };
    const bodies: Drawn[] = [{ id: "earth", p: this.pos("earth", absMs) }];
    for (const b of BODIES) if (b.id !== "belt") bodies.push({ id: b.id, p: this.pos(b.id, absMs) });
    const behind = bodies.filter((b) => b.p.y < this.cy);
    const front = bodies.filter((b) => b.p.y >= this.cy);

    for (const b of behind) this.drawBody(m, d, b.id, b.p, realT);
    this.drawSun(c, dim, realT);
    this.drawSwarm(m, realT, absMs);
    for (const b of front) this.drawBody(m, d, b.id, b.p, realT);

    this.drawMissions(m, absMs);

    // hover ring
    if (this.hover) {
      const h = this.hitboxes.find((x) => x.id === this.hover);
      if (h) {
        ctx.strokeStyle = "rgba(127,227,255,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawSun(c: number, dim: number, realT: number): void {
    const ctx = this.ctx;
    const { cx, cy, sunR } = this;
    const flicker = 1 + 0.02 * Math.sin(realT * 3.1);
    const glow = ctx.createRadialGradient(cx, cy, sunR * 0.5, cx, cy, sunR * 6 * flicker);
    glow.addColorStop(0, `rgba(255,200,90,${(0.55 * dim).toFixed(3)})`);
    glow.addColorStop(0.35, `rgba(255,140,40,${(0.16 * dim).toFixed(3)})`);
    glow.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, sunR * 6 * flicker, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(cx - sunR * 0.3, cy - sunR * 0.3, 1, cx, cy, sunR);
    core.addColorStop(0, mix("#fff8e0", "#3a2a10", 1 - dim));
    core.addColorStop(0.6, mix("#ffd166", "#2a1c08", 1 - dim));
    core.addColorStop(1, mix("#ff9a2a", "#1a1206", 1 - dim));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, sunR, 0, Math.PI * 2);
    ctx.fill();
    this.hitboxes.push({ id: "sun", x: cx, y: cy, r: sunR });
  }

  private drawSwarm(m: SpaceModel, realT: number, absMs: number): void {
    const c = m.coverage;
    if (c <= 0 && m.b.foundry === 0) return;
    const ctx = this.ctx;
    const [r0, r1] = this.swarmR();

    // The shell: as coverage climbs, the cloud of collectors reads as a solid sphere.
    if (c > 0.3) {
      const a = Math.pow((c - 0.3) / 0.7, 1.4);
      const R = r1 * 0.86;
      const g = ctx.createRadialGradient(this.cx - R * 0.3, this.cy - R * 0.35, R * 0.1, this.cx, this.cy, R);
      g.addColorStop(0, `rgba(92,70,24,${(0.95 * a).toFixed(3)})`);
      g.addColorStop(0.7, `rgba(46,34,12,${(0.95 * a).toFixed(3)})`);
      g.addColorStop(1, `rgba(120,92,34,${(0.9 * a).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
      ctx.fill();
      // latitude/longitude construction lines
      ctx.strokeStyle = `rgba(255,210,63,${(0.18 * a).toFixed(3)})`;
      ctx.lineWidth = 0.7;
      for (let i = 1; i < 5; i++) {
        const ry = R * (i / 5);
        ctx.beginPath();
        ctx.ellipse(this.cx, this.cy, R, ry * 0.35 + R * 0.02, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(this.cx, this.cy, R * Math.cos((i * Math.PI) / 10), R, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const n = Math.round(1800 * Math.pow(Math.min(1, c), 0.45));
    for (let i = 0; i < n; i++) {
      const p = this.swarm[i];
      const r = r0 + (r1 - r0) * p.f;
      const th = p.th + p.w * realT * (1.2 - p.f * 0.6);
      const ex = r * Math.cos(th);
      const ey = r * Math.sin(th) * p.ratio;
      const x = this.cx + ex * Math.cos(p.rot) - ey * Math.sin(p.rot);
      const y = this.cy + (ex * Math.sin(p.rot) + ey * Math.cos(p.rot)) * 0.85;
      const s = Math.pow(Math.max(0, Math.sin(realT * p.glint + p.ph)), 12);
      const a = 0.45 + 0.55 * s;
      ctx.fillStyle = s > 0.6 ? `rgba(255,250,220,${a.toFixed(3)})` : `rgba(255,210,63,${a.toFixed(3)})`;
      const sz = s > 0.6 ? 1.8 : 1.1;
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }

    // Debris stream from Mercury to the swarm while foundries are working.
    if (m.b.foundry > 0 && c < 1) {
      const mp = this.pos("mercury", absMs);
      const count = Math.min(40, 8 + m.b.foundry * 2);
      for (let i = 0; i < count; i++) {
        const u = (realT * 0.35 + i / count) % 1;
        const ang = Math.atan2(mp.y - this.cy, mp.x - this.cx) + Math.sin(i * 12.9898) * 0.9;
        const tx = this.cx + Math.cos(ang) * (r0 + (r1 - r0) * ((i * 0.37) % 1));
        const ty = this.cy + Math.sin(ang) * (r0 + (r1 - r0) * ((i * 0.37) % 1)) * 0.85;
        const x = mp.x + (tx - mp.x) * u;
        const y = mp.y + (ty - mp.y) * u;
        ctx.fillStyle = `rgba(255,190,90,${(0.8 * (1 - u)).toFixed(3)})`;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
    }
  }

  private drawBody(m: SpaceModel, d: Derived, id: Target, p: Pt, realT: number): void {
    const ctx = this.ctx;
    const s = this.scale;
    if (id === "earth") {
      const r = 4.8 * s;
      // heat halo
      if (m.temp > 28) {
        const k = Math.min(1, (m.temp - 28) / 380);
        const g = ctx.createRadialGradient(p.x, p.y, r * 0.8, p.x, p.y, r * (2.2 + 2 * k));
        g.addColorStop(0, `rgba(255,90,40,${(0.25 + 0.5 * k).toFixed(3)})`);
        g.addColorStop(1, "rgba(255,90,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (2.2 + 2 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = earthColor(d.earthConv);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      // a sliver of green while there is still some
      if (d.earthConv < 0.4) {
        ctx.fillStyle = `rgba(80,170,90,${(0.8 * (1 - d.earthConv / 0.4)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x - r * 0.25, p.y - r * 0.1, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      // city lights / industry sparkle
      if (d.earthConv > 0.1) {
        const n = Math.floor(d.earthConv * 10);
        for (let i = 0; i < n; i++) {
          const a = i * 2.4 + realT * 0.3;
          const rr = r * 0.7 * ((i * 0.618) % 1);
          ctx.fillStyle = "rgba(255,220,120,0.9)";
          ctx.fillRect(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 1, 1);
        }
      }
      this.label("Earth", p, r, d.earthConv > 0.55 ? GOLD : "rgba(160,190,230,0.8)");
      this.hitboxes.push({ id, x: p.x, y: p.y, r });
      return;
    }
    if (id === "sun") return;
    const b = BODY[id];
    const claimed = !!m.claimed[id];
    let r = Math.max(1.3, b.size * s);
    if (id === "mercury") r *= Math.pow(Math.max(0, 1 - m.coverage), 1 / 3);
    if (r < 0.4) return;
    const col = claimed ? mix(b.color, GOLD, 0.7) : b.color;

    if (id === "saturn") {
      ctx.strokeStyle = claimed ? "rgba(255,210,63,0.7)" : "rgba(230,210,160,0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 2.1, r * 0.7, -0.25, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (id === "jupiter" && !claimed) {
      ctx.fillStyle = "rgba(160,110,70,0.5)";
      ctx.fillRect(p.x - r, p.y - r * 0.2, r * 2, r * 0.25);
      ctx.fillRect(p.x - r * 0.9, p.y + r * 0.3, r * 1.8, r * 0.18);
    }
    if (claimed) {
      const pulse = 0.35 + 0.25 * Math.sin(realT * 2 + r);
      ctx.strokeStyle = `rgba(255,210,63,${pulse.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (id !== "moon") this.label(b.name, p, r, claimed ? GOLD : m.missions.some((x) => x.body === id) ? "#7fe3ff" : "rgba(170,180,195,0.7)");
    this.hitboxes.push({ id, x: p.x, y: p.y, r: Math.max(r, 3) });
  }

  private label(text: string, p: Pt, r: number, color: string): void {
    if (this.maxR < 150) return;
    const ctx = this.ctx;
    ctx.font = `${Math.round(10 * Math.max(1, this.scale * 0.85))}px 'IBM Plex Mono', ui-monospace, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, p.x + r + 5, p.y - r - 3);
  }

  private drawMissions(m: SpaceModel, absMs: number): void {
    const ctx = this.ctx;
    for (const mi of m.missions) {
      const u = Math.min(1, (m.worldMs - mi.start) / mi.dur);
      const abs0 = absMs - (m.worldMs - mi.start);
      const p0 = this.pos("earth", abs0);
      const p1 = this.pos(mi.body, absMs);
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const bend = mi.body === "moon" ? 0.15 : 0.3;
      const cxp = mx - dy * bend;
      const cyp = my + dx * bend;
      const at = (t: number): Pt => ({
        x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * cxp + t * t * p1.x,
        y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * cyp + t * t * p1.y,
      });
      // planned path
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = "rgba(127,227,255,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(cxp, cyp, p1.x, p1.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // trail
      for (let k = 0; k < 10; k++) {
        const t = Math.max(0, u - k * 0.012);
        const q = at(t);
        ctx.fillStyle = `rgba(127,227,255,${(0.6 * (1 - k / 10)).toFixed(3)})`;
        ctx.fillRect(q.x - 0.8, q.y - 0.8, 1.6, 1.6);
      }
      const q = at(u);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
