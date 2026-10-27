import {
  BOOST_ACCEL,
  GRAVITY,
  MAX_SPEED,
  MU,
  PX_PER_M,
  RADIUS,
  REST,
  TAU,
  angleDiff,
  clamp,
  type Ink,
  type Pt,
  type Stroke,
  type Track,
} from "./types.ts";

const CELL = 72;
const SKIN = 0.8;
const STEP_SPLIT = RADIUS * 0.45;

type Seg = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ink: Ink;
};

export type Floater = { x: number; y: number; text: string; life: number; max: number };
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: "spark" | "debris";
};

export type Dot = { x: number; y: number; px: number; py: number };

export type Ragdoll = { dots: Dot[] };

export type Rider = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  omega: number;
  grounded: boolean;
  crashed: boolean;
  gnx: number;
  gny: number;
  spinAccum: number;
  ink: Ink | null;
};

type Snapshot = { strokes: Stroke[]; flag: Pt };

export type Sim = {
  strokes: Stroke[];
  flag: Pt;
  rider: Rider;
  ragdoll: Ragdoll | null;
  running: boolean;
  atStart: boolean;
  slow: boolean;
  distance: number;
  flips: number;
  bestDist: number;
  bestFlips: number;
  startX: number;
  floaters: Floater[];
  particles: Particle[];
  trauma: number;
  flash: number;
  hitstop: number;
  stuckTime: number;
  newBest: boolean;
  announcedBest: boolean;
  airTime: number;
  kickCd: number;
  trickTime: number;
  wantKick: boolean;
  sfx: string[];
  scrape: number;
  scrapeInk: Ink | null;
  time: number;
  nextId: number;
  undo: Snapshot[];
  trackName: string;
  segs: Seg[];
  hash: Map<number, number[]>;
  seen: Uint32Array;
  stamp: number;
  dirty: boolean;
};

const LINKS: [number, number, number][] = [
  [0, 1, 12],
  [1, 2, 16],
  [1, 3, 14],
  [1, 4, 13],
  [2, 5, 15],
  [2, 6, 16],
  [7, 8, 24],
];

function riderInit(x: number, y: number): Rider {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    omega: 0,
    grounded: false,
    crashed: false,
    gnx: 0,
    gny: -1,
    spinAccum: 0,
    ink: null,
  };
}

export function createSim(): Sim {
  return {
    strokes: [],
    flag: { x: 180, y: 280 },
    rider: riderInit(180, 280),
    ragdoll: null,
    running: false,
    atStart: true,
    slow: false,
    distance: 0,
    flips: 0,
    bestDist: 0,
    bestFlips: 0,
    startX: 180,
    floaters: [],
    particles: [],
    trauma: 0,
    flash: 0,
    hitstop: 0,
    stuckTime: 0,
    newBest: false,
    announcedBest: false,
    airTime: 0,
    kickCd: 0,
    trickTime: 0,
    wantKick: false,
    sfx: [],
    scrape: 0,
    scrapeInk: null,
    time: 0,
    nextId: 1,
    undo: [],
    trackName: "First hill",
    segs: [],
    hash: new Map(),
    seen: new Uint32Array(0),
    stamp: 1,
    dirty: true,
  };
}

function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    id: s.id,
    ink: s.ink,
    pts: s.pts.map((p) => ({ x: p.x, y: p.y })),
  }));
}

export function pushUndo(sim: Sim): void {
  sim.undo.push({
    strokes: cloneStrokes(sim.strokes),
    flag: { x: sim.flag.x, y: sim.flag.y },
  });
  if (sim.undo.length > 40) sim.undo.shift();
}

export function undo(sim: Sim): void {
  const snap = sim.undo.pop();
  if (!snap) return;
  sim.strokes = snap.strokes;
  sim.flag = snap.flag;
  sim.dirty = true;
  let max = 0;
  for (const s of sim.strokes) if (s.id > max) max = s.id;
  sim.nextId = max + 1;
}

export function clearLines(sim: Sim): void {
  pushUndo(sim);
  sim.strokes = [];
  sim.dirty = true;
}

export function loadTrack(sim: Sim, track: Track, recordUndo: boolean): void {
  if (recordUndo) pushUndo(sim);
  sim.strokes = cloneStrokes(track.strokes);
  sim.flag = { x: track.flag.x, y: track.flag.y };
  sim.trackName = track.name;
  sim.dirty = true;
  let max = 0;
  for (const s of sim.strokes) if (s.id > max) max = s.id;
  sim.nextId = Math.max(sim.nextId, max + 1);
  resetRider(sim);
}

export function moveFlag(sim: Sim, x: number, y: number): void {
  sim.flag.x = x;
  sim.flag.y = y;
  if (sim.atStart && !sim.running) {
    sim.startX = x;
  }
}

export function beginStroke(sim: Sim, ink: Ink, x: number, y: number): void {
  pushUndo(sim);
  sim.strokes.push({ id: sim.nextId++, ink, pts: [{ x, y }] });
  sim.dirty = true;
}

export function extendStroke(sim: Sim, x: number, y: number): void {
  const s = sim.strokes[sim.strokes.length - 1];
  if (!s) return;
  const last = s.pts[s.pts.length - 1];
  if (!last) return;
  const dx = x - last.x;
  const dy = y - last.y;
  if (dx * dx + dy * dy < 12) return;
  s.pts.push({ x, y });
  sim.dirty = true;
}

export function endStroke(sim: Sim): void {
  const s = sim.strokes[sim.strokes.length - 1];
  if (s && s.pts.length < 2) {
    sim.strokes.pop();
    sim.dirty = true;
  }
}

export function commitLine(sim: Sim, ink: Ink, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;
  pushUndo(sim);
  const n = Math.max(1, Math.ceil(len / 8));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x0 + dx * t, y: y0 + dy * t });
  }
  sim.strokes.push({ id: sim.nextId++, ink, pts });
  sim.dirty = true;
}

export function eraseAt(sim: Sim, x: number, y: number): void {
  const r = 18;
  const r2 = r * r;
  const next: Stroke[] = [];
  let changed = false;
  for (const s of sim.strokes) {
    let run: Pt[] = [];
    const flush = () => {
      if (run.length >= 2) next.push({ id: sim.nextId++, ink: s.ink, pts: run });
      run = [];
    };
    for (const p of s.pts) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r2) {
        changed = true;
        flush();
      } else {
        run.push(p);
      }
    }
    flush();
  }
  if (changed) {
    sim.strokes = next;
    sim.dirty = true;
  }
}

function rebuild(sim: Sim): void {
  if (!sim.dirty) return;
  const segs: Seg[] = [];
  for (const s of sim.strokes) {
    const pts = s.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      if ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) < 0.25) continue;
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, ink: s.ink });
    }
  }
  const hash = new Map<number, number[]>();
  const reach = RADIUS + 2;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s) continue;
    const minX = Math.floor((Math.min(s.ax, s.bx) - reach) / CELL);
    const maxX = Math.floor((Math.max(s.ax, s.bx) + reach) / CELL);
    const minY = Math.floor((Math.min(s.ay, s.by) - reach) / CELL);
    const maxY = Math.floor((Math.max(s.ay, s.by) + reach) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const k = cellKey(cx, cy);
        let bucket = hash.get(k);
        if (!bucket) {
          bucket = [];
          hash.set(k, bucket);
        }
        bucket.push(i);
      }
    }
  }
  sim.segs = segs;
  sim.hash = hash;
  sim.seen = new Uint32Array(segs.length);
  sim.stamp = 1;
  sim.dirty = false;
}

function cellKey(cx: number, cy: number): number {
  const x = cx >= 0 ? cx * 2 : -cx * 2 - 1;
  const y = cy >= 0 ? cy * 2 : -cy * 2 - 1;
  return x * 65536 + y;
}

type Hit = { nx: number; ny: number; pen: number; ink: Ink; d: number };

function queryHits(sim: Sim, x: number, y: number, rad: number): Hit[] {
  const hits: Hit[] = [];
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const stamp = ++sim.stamp;
  if (sim.stamp > 4_000_000_000) {
    sim.seen.fill(0);
    sim.stamp = 1;
  }
  const rad2 = (rad + SKIN) * (rad + SKIN);
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const bucket = sim.hash.get(cellKey(cx + ox, cy + oy));
      if (!bucket) continue;
      for (const idx of bucket) {
        if (sim.seen[idx] === stamp) continue;
        sim.seen[idx] = stamp;
        const s = sim.segs[idx];
        if (!s) continue;
        const abx = s.bx - s.ax;
        const aby = s.by - s.ay;
        const len2 = abx * abx + aby * aby;
        let t = len2 > 1e-8 ? ((x - s.ax) * abx + (y - s.ay) * aby) / len2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const qx = s.ax + abx * t;
        const qy = s.ay + aby * t;
        const dx = x - qx;
        const dy = y - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 > rad2) continue;
        let nx: number;
        let ny: number;
        let d: number;
        if (d2 > 1e-6) {
          d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
        } else {
          const len = Math.sqrt(len2) || 1;
          nx = -aby / len;
          ny = abx / len;
          if (ny > 0) {
            nx = -nx;
            ny = -ny;
          }
          d = 0;
        }
        hits.push({ nx, ny, pen: rad - d, ink: s.ink, d });
      }
    }
  }
  return hits;
}

function upwardNormal(ax: number, ay: number, bx: number, by: number): { nx: number; ny: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

function seatOnLine(sim: Sim): void {
  rebuild(sim);
  const x = sim.flag.x;
  let bestY = Infinity;
  let best: { y: number; nx: number; ny: number } | null = null;
  const cx0 = Math.floor(x / CELL);
  const y0 = sim.flag.y - 8;
  const y1 = sim.flag.y + 300;
  const cy0 = Math.floor(y0 / CELL);
  const cy1 = Math.floor(y1 / CELL);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const bucket = sim.hash.get(cellKey(cx0 + ox, cy));
      if (!bucket) continue;
      for (const idx of bucket) {
        const s = sim.segs[idx];
        if (!s) continue;
        const dx = s.bx - s.ax;
        if (Math.abs(dx) < 0.4) continue;
        const t = (x - s.ax) / dx;
        if (t < -0.02 || t > 1.02) continue;
        const y = s.ay + (s.by - s.ay) * clamp(t, 0, 1);
        if (y < sim.flag.y - 6 || y > sim.flag.y + 300) continue;
        if (y < bestY) {
          const n = upwardNormal(s.ax, s.ay, s.bx, s.by);
          if (!n || n.ny > -0.15) continue;
          bestY = y;
          best = { y, nx: n.nx, ny: n.ny };
        }
      }
    }
  }
  const r = sim.rider;
  r.vx = 0;
  r.vy = 0;
  r.omega = 0;
  r.spinAccum = 0;
  r.crashed = false;
  r.ink = null;
  sim.ragdoll = null;
  if (best) {
    r.x = x + best.nx * RADIUS;
    r.y = best.y + best.ny * RADIUS;
    r.gnx = best.nx;
    r.gny = best.ny;
    r.grounded = true;
    const tx = -best.ny;
    const ty = best.nx;
    const fx = tx < 0 ? -tx : tx;
    const fy = tx < 0 ? -ty : ty;
    r.angle = Math.atan2(fy, fx);
  } else {
    r.x = sim.flag.x;
    r.y = sim.flag.y;
    r.grounded = false;
    r.gnx = 0;
    r.gny = -1;
    r.angle = 0.15;
  }
}

export function resetRider(sim: Sim): void {
  sim.rider = riderInit(sim.flag.x, sim.flag.y);
  sim.ragdoll = null;
  sim.atStart = true;
  sim.distance = 0;
  sim.flips = 0;
  sim.startX = sim.flag.x;
  sim.floaters = [];
  sim.particles = [];
  sim.trauma = 0;
  sim.flash = 0;
  sim.hitstop = 0;
  sim.stuckTime = 0;
  sim.newBest = false;
  sim.announcedBest = false;
  sim.airTime = 0;
  sim.kickCd = 0;
  sim.trickTime = 0;
  sim.scrape = 0;
  sim.running = false;
  seatOnLine(sim);
}

function spawnDot(x: number, y: number, vx: number, vy: number, dt: number): Dot {
  return { x, y, px: x - vx * dt, py: y - vy * dt };
}

function spawnRagdoll(sim: Sim, dt: number): void {
  const r = sim.rider;
  const fx = Math.cos(r.angle);
  const fy = Math.sin(r.angle);
  const ux = fy;
  const uy = -fx;
  const spec: [number, number][] = [
    [2, 28],
    [-1, 16],
    [-2, 2],
    [-12, 14],
    [8, 18],
    [10, 1],
    [-8, 1],
    [-8, -8],
    [14, -6],
  ];
  const dots: Dot[] = [];
  for (let i = 0; i < spec.length; i++) {
    const s = spec[i];
    if (!s) continue;
    const jx = (Math.random() - 0.5) * 40;
    const jy = -80 - Math.random() * 80;
    const spin = (i - 3) * 60;
    dots.push(
      spawnDot(
        r.x + fx * s[0] + ux * s[1],
        r.y + fy * s[0] + uy * s[1],
        r.vx + jx + -fy * spin,
        r.vy + jy + fx * spin,
        dt,
      ),
    );
  }
  sim.ragdoll = { dots };
}

function ragdollStep(sim: Sim, dt: number): void {
  const rag = sim.ragdoll;
  if (!rag) return;
  const damp = 0.992;
  for (const p of rag.dots) {
    const vx = (p.x - p.px) * damp;
    const vy = (p.y - p.py) * damp;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy + GRAVITY * dt * dt;
  }
  for (let iter = 0; iter < 5; iter++) {
    for (const [ia, ib, rest] of LINKS) {
      const a = rag.dots[ia];
      const b = rag.dots[ib];
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const diff = ((dist - rest) / dist) * 0.55;
      dx *= diff;
      dy *= diff;
      a.x += dx;
      a.y += dy;
      b.x -= dx;
      b.y -= dy;
    }
  }
  for (const p of rag.dots) {
    const hits = queryHits(sim, p.x, p.y, 4.5);
    let best: Hit | null = null;
    for (const h of hits) if (h.pen > 0 && (!best || h.pen > best.pen)) best = h;
    if (!best) continue;
    p.x += best.nx * best.pen;
    p.y += best.ny * best.pen;
    const vx = p.x - p.px;
    const vy = p.y - p.py;
    const vn = vx * best.nx + vy * best.ny;
    if (vn < 0) {
      p.px += vn * best.nx * 0.85;
      p.py += vn * best.ny * 0.85;
    }
  }
}

function applyDrag(r: Rider, dt: number): void {
  const sp = Math.hypot(r.vx, r.vy);
  if (sp < 1) return;
  const dec = Math.min(sp, 0.00032 * sp * sp * dt);
  r.vx -= (r.vx / sp) * dec;
  r.vy -= (r.vy / sp) * dec;
  if (sp > MAX_SPEED) {
    const s = MAX_SPEED / sp;
    r.vx *= s;
    r.vy *= s;
  }
}

function crash(sim: Sim, dt: number, reason: string): void {
  if (sim.rider.crashed) return;
  sim.rider.crashed = true;
  sim.rider.grounded = false;
  spawnRagdoll(sim, dt);
  sim.hitstop = 0.07;
  sim.trauma = Math.min(1, sim.trauma + 0.85);
  sim.flash = 1;
  sim.scrape = 0;
  sim.sfx.push("crash");
  floater(sim, sim.rider.x, sim.rider.y - 30, reason);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * TAU;
    const s = 40 + Math.random() * 220;
    burst(sim, sim.rider.x, sim.rider.y, Math.cos(a) * s, Math.sin(a) * s - 80, "debris");
  }
  noteBest(sim);
}

function floater(sim: Sim, x: number, y: number, text: string): void {
  sim.floaters.push({ x, y, text, life: 1.15, max: 1.15 });
  if (sim.floaters.length > 8) sim.floaters.shift();
}

function burst(sim: Sim, x: number, y: number, vx: number, vy: number, kind: Particle["kind"]): void {
  sim.particles.push({ x, y, vx, vy, life: 0.45, max: 0.45, kind });
  if (sim.particles.length > 80) sim.particles.splice(0, sim.particles.length - 80);
}

function noteBest(sim: Sim): void {
  if (sim.distance > sim.bestDist + 0.05) {
    sim.bestDist = sim.distance;
    sim.newBest = true;
    if (!sim.announcedBest && sim.distance > 8) {
      sim.announcedBest = true;
      floater(sim, sim.rider.x, sim.rider.y - 48, "New best");
    }
  }
  if (sim.flips > sim.bestFlips) sim.bestFlips = sim.flips;
}

function integrateRider(sim: Sim, dt: number): void {
  const r = sim.rider;
  if (r.crashed) return;

  const wasGrounded = r.grounded;
  r.vy += GRAVITY * dt;
  applyDrag(r, dt);

  if (!r.grounded && sim.wantKick && sim.kickCd <= 0) {
    r.omega += 12;
    sim.kickCd = 0.28;
    sim.trickTime = Math.max(sim.trickTime, 0.7);
    sim.wantKick = false;
    sim.sfx.push("kick");
    floater(sim, r.x, r.y - 24, "Kick");
  } else if (r.grounded) {
    sim.wantKick = false;
  }

  r.x += r.vx * dt;
  r.y += r.vy * dt;

  let contact: Hit | null = null;
  for (let iter = 0; iter < 5; iter++) {
    const hits = queryHits(sim, r.x, r.y, RADIUS);
    let best: Hit | null = null;
    for (const h of hits) {
      if (h.pen > 0 && (!best || h.pen > best.pen)) best = h;
    }
    if (!best) {
      if (!contact) {
        for (const h of hits) {
          if (!contact || h.d < contact.d) contact = h;
        }
      }
      break;
    }
    r.x += best.nx * best.pen;
    r.y += best.ny * best.pen;
    contact = best;
  }

  r.grounded = false;
  r.ink = null;
  if (contact && contact.d <= RADIUS + SKIN) {
    const vn = r.vx * contact.nx + r.vy * contact.ny;
    const impact = Math.max(0, -vn);
    const e = impact > 70 ? REST[contact.ink] : 0;
    if (vn < 0) {
      r.vx -= (1 + e) * vn * contact.nx;
      r.vy -= (1 + e) * vn * contact.ny;
    }
    const vn2 = r.vx * contact.nx + r.vy * contact.ny;
    let tx = r.vx - vn2 * contact.nx;
    let ty = r.vy - vn2 * contact.ny;
    const sp = Math.hypot(tx, ty);
    if (contact.ink === "boost") {
      let dx: number;
      let dy: number;
      if (sp > 24) {
        dx = tx / sp;
        dy = ty / sp;
      } else {
        dx = -contact.ny;
        dy = contact.nx;
        if (dy < 0) {
          dx = -dx;
          dy = -dy;
        }
      }
      tx += dx * BOOST_ACCEL * dt;
      ty += dy * BOOST_ACCEL * dt;
    } else if (sp > 0.001) {
      const ns = Math.max(0, sp - MU[contact.ink] * GRAVITY * dt);
      const s = ns / sp;
      tx *= s;
      ty *= s;
    }
    r.vx = tx + vn2 * contact.nx;
    r.vy = ty + vn2 * contact.ny;
    const sp2 = Math.hypot(r.vx, r.vy);
    if (sp2 > MAX_SPEED) {
      const s = MAX_SPEED / sp2;
      r.vx *= s;
      r.vy *= s;
    }

    r.grounded = true;
    r.gnx = contact.nx;
    r.gny = contact.ny;
    r.ink = contact.ink;

    let fx = -contact.ny;
    let fy = contact.nx;
    const spd = Math.hypot(r.vx, r.vy);
    if (spd > 30) {
      if (r.vx * fx + r.vy * fy < 0) {
        fx = -fx;
        fy = -fy;
      }
    } else if (fx < 0) {
      fx = -fx;
      fy = -fy;
    }
    const target = Math.atan2(fy, fx);
    const err = angleDiff(target, r.angle);
    const wall = Math.abs(contact.nx) > 0.92;
    const hard = impact > 1650 || (wall && impact > 820);
    const messy = !wasGrounded && Math.abs(err) > 2.1 && impact > 380;
    if (hard || messy) {
      crash(sim, dt, hard ? "Wiped out" : "Botched landing");
      return;
    }

    if (!wasGrounded) {
      const nFlips = Math.floor(Math.abs(r.spinAccum) / TAU + 0.12);
      if (nFlips > 0 && impact < 900) {
        sim.flips += nFlips;
        const label = nFlips === 1 ? "Flip" : nFlips === 2 ? "Double" : nFlips === 3 ? "Triple" : `${nFlips} flips`;
        floater(sim, r.x, r.y - 36, label);
        sim.sfx.push("flip");
        sim.trauma = Math.min(1, sim.trauma + 0.25);
      }
      r.spinAccum = 0;
      if (contact.ink === "spring" && impact > 80) {
        sim.sfx.push("bounce");
        sim.trauma = Math.min(1, sim.trauma + 0.18);
      } else if (impact > 280) {
        sim.trauma = Math.min(1, sim.trauma + 0.12);
        sim.sfx.push("land");
      }
      r.angle += err;
      r.omega *= 0.25;
    } else {
      const applied = err * Math.min(1, dt * 16);
      r.angle += applied;
      r.omega = clamp(applied / dt, -11, 11);
      r.spinAccum = 0;
    }

    if (contact.ink === "boost" && !wasGrounded) sim.sfx.push("boost");
    if (contact.ink === "boost" && wasGrounded && Math.random() < 0.04) {
      /* occasional whoosh handled by scrape */
    }
    const spark = Math.hypot(r.vx, r.vy);
    sim.scrape = clamp(spark / 900, 0, 1);
    sim.scrapeInk = contact.ink;
    if (spark > 260 && Math.random() < dt * 28) {
      burst(sim, r.x - r.gnx * 8, r.y - r.gny * 8, -r.vx * 0.1 + (Math.random() - 0.5) * 40, -r.vy * 0.1, "spark");
    }
    if (contact.ink === "spring" && impact > 80) {
      for (let i = 0; i < 6; i++) {
        burst(sim, r.x, r.y, (Math.random() - 0.5) * 160, -Math.random() * 180, "spark");
      }
    }
  } else {
    const sp = Math.hypot(r.vx, r.vy);
    if (sim.trickTime > 0 || sp < 40) {
      r.angle += r.omega * dt;
      r.spinAccum += r.omega * dt;
      r.omega *= Math.exp(-0.35 * dt);
    } else {
      const aim = Math.atan2(r.vy, r.vx);
      const turn = angleDiff(aim, r.angle);
      const applied = turn * Math.min(1, dt * 9);
      r.angle += applied;
      r.omega = clamp(applied / Math.max(dt, 1e-4), -8, 8);
    }
    sim.scrape = 0;
    sim.scrapeInk = null;
    if (wasGrounded) sim.airTime = 0;
  }

  if (!r.grounded) sim.airTime += dt;
  else sim.airTime = 0;

  if (r.y > 6000 || r.y < -4000 || Math.abs(r.x) > 80000) {
    crash(sim, dt, "Fell off");
  }
}

export function step(sim: Sim, dt: number): void {
  sim.time += dt;
  sim.kickCd = Math.max(0, sim.kickCd - dt);
  sim.trickTime = Math.max(0, sim.trickTime - dt);
  sim.trauma = Math.max(0, sim.trauma - dt * 1.7);
  sim.flash = Math.max(0, sim.flash - dt * 3.2);

  for (let i = sim.floaters.length - 1; i >= 0; i--) {
    const f = sim.floaters[i];
    if (!f) continue;
    f.life -= dt;
    f.y -= 22 * dt;
    if (f.life <= 0) sim.floaters.splice(i, 1);
  }
  for (let i = sim.particles.length - 1; i >= 0; i--) {
    const p = sim.particles[i];
    if (!p) continue;
    p.life -= dt;
    p.vy += GRAVITY * 0.35 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) sim.particles.splice(i, 1);
  }

  if (!sim.running) {
    if (sim.atStart) seatOnLine(sim);
    sim.scrape = 0;
    return;
  }

  if (sim.hitstop > 0) {
    sim.hitstop -= dt;
    sim.scrape = 0;
    return;
  }

  rebuild(sim);

  if (sim.rider.crashed) {
    ragdollStep(sim, dt);
    sim.scrape = 0;
    return;
  }

  const r = sim.rider;
  const dist = Math.hypot(r.vx, r.vy) * dt + GRAVITY * dt * dt;
  const n = clamp(Math.ceil(dist / STEP_SPLIT), 1, 6);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    integrateRider(sim, h);
    if (sim.rider.crashed) break;
  }

  if (!sim.rider.crashed) {
    const progressed = (sim.rider.x - sim.startX) / PX_PER_M;
    if (progressed > sim.distance) {
      sim.distance = progressed;
      if (sim.distance > sim.bestDist) noteBest(sim);
    }
    const sp = Math.hypot(sim.rider.vx, sim.rider.vy);
    if (sim.rider.grounded && sp < 18) sim.stuckTime += dt;
    else sim.stuckTime = 0;
    sim.atStart = false;
  }
}

export function kick(sim: Sim): void {
  if (!sim.running || sim.rider.crashed || sim.rider.grounded) return;
  sim.wantKick = true;
}

export function selfTest(): string[] {
  const fails: string[] = [];
  const slope = createSim();
  slope.strokes = [
    {
      id: 1,
      ink: "slope",
      pts: [
        { x: 0, y: 80 },
        { x: 900, y: 420 },
      ],
    },
  ];
  slope.flag = { x: 40, y: 40 };
  slope.dirty = true;
  slope.nextId = 2;
  resetRider(slope);
  slope.running = true;
  slope.atStart = false;
  for (let i = 0; i < 240; i++) step(slope, 1 / 60);
  if (slope.rider.crashed) fails.push("gentle slope crashed");
  if (slope.rider.x < 180) fails.push(`gentle slope barely moved x=${slope.rider.x.toFixed(1)}`);

  const wall = createSim();
  wall.strokes = [
    {
      id: 1,
      ink: "slope",
      pts: [
        { x: 200, y: -200 },
        { x: 200, y: 200 },
      ],
    },
  ];
  wall.dirty = true;
  wall.rider.x = 40;
  wall.rider.y = 0;
  wall.rider.vx = 2200;
  wall.rider.vy = 0;
  wall.running = true;
  wall.atStart = false;
  for (let i = 0; i < 90; i++) step(wall, 1 / 60);
  if (wall.rider.x > 200 + RADIUS + 2 && !wall.rider.crashed) {
    fails.push(`tunneled a wall x=${wall.rider.x.toFixed(1)}`);
  }

  const ice = createSim();
  const dirt = createSim();
  for (const s of [ice, dirt]) {
    s.strokes = [
      {
        id: 1,
        ink: "slope",
        pts: [
          { x: -100, y: 100 },
          { x: 2000, y: 100 },
        ],
      },
    ];
    s.dirty = true;
    s.running = true;
    s.atStart = false;
    s.rider.x = 0;
    s.rider.y = 100 - RADIUS;
    s.rider.vx = 700;
    s.rider.vy = 0;
    s.rider.grounded = true;
    s.rider.gnx = 0;
    s.rider.gny = -1;
  }
  ice.strokes[0]!.ink = "ice";
  for (let i = 0; i < 120; i++) {
    step(ice, 1 / 60);
    step(dirt, 1 / 60);
  }
  if (!(ice.rider.x > dirt.rider.x + 40)) {
    fails.push(`ice not faster ice=${ice.rider.x.toFixed(0)} dirt=${dirt.rider.x.toFixed(0)}`);
  }

  const spring = createSim();
  spring.strokes = [
    {
      id: 1,
      ink: "spring",
      pts: [
        { x: -50, y: 200 },
        { x: 200, y: 200 },
      ],
    },
  ];
  spring.dirty = true;
  spring.running = true;
  spring.atStart = false;
  spring.rider.x = 40;
  spring.rider.y = 40;
  spring.rider.vy = 0;
  for (let i = 0; i < 90; i++) step(spring, 1 / 60);
  if (spring.rider.y > 190 && spring.rider.vy >= 0 && !spring.rider.crashed) {
    fails.push("spring did not bounce");
  }

  return fails;
}
