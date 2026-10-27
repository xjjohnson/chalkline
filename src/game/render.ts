import { palette } from "./palette.ts";
import type { Ragdoll, Rider, Sim } from "./sim.ts";
import { RADIUS } from "./types.ts";
import type { Ink, Stroke } from "./types.ts";

export type Scarf = { x: number; y: number }[];

type Snow = { x: number; y: number; r: number; v: number; drift: number };

const snow: Snow[] = Array.from({ length: 48 }, (_, i) => ({
  x: (i * 97) % 1400,
  y: (i * 53) % 800,
  r: 0.6 + (i % 5) * 0.25,
  v: 12 + (i % 7) * 4,
  drift: ((i % 9) - 4) * 3,
}));

let grain: HTMLCanvasElement | null = null;

function paperGrain(): HTMLCanvasElement {
  if (grain) return grain;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) return c;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const a = Math.random() * 0.05;
    g.fillStyle = `rgba(26,24,20,${a})`;
    g.fillRect(x, y, 1, 1);
  }
  grain = c;
  return c;
}

function inkStyle(ink: Ink): string {
  if (ink === "ice") return palette.ice;
  return palette.ink;
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  camX: number,
  camY: number,
  zoom: number,
  shakeX: number,
  shakeY: number,
  sim: Sim,
  scarf: Scarf,
  linePreview: { x0: number; y0: number; x1: number; y1: number; ink: Ink } | null,
  eraser: { x: number; y: number } | null,
  dt: number,
  reduce: boolean,
): void {
  const { paper, ink, muted, scarf: scarfColor, hill, hillFar } = palette;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  sky.addColorStop(0, "#e7e2d6");
  sky.addColorStop(0.55, paper);
  sky.addColorStop(1, "#efe8da");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cssW, cssH);

  drawHill(ctx, cssW, cssH, camX, zoom, 0.12, 46, hillFar, 0.62);
  drawHill(ctx, cssW, cssH, camX, zoom, 0.28, 28, hill, 0.78);
  drawPines(ctx, cssW, cssH, camX, zoom);

  ctx.setTransform(
    dpr * zoom,
    0,
    0,
    dpr * zoom,
    dpr * (cssW / 2 - camX * zoom + shakeX),
    dpr * (cssH / 2 - camY * zoom + shakeY),
  );

  const viewHalfW = cssW / zoom;
  const viewHalfH = cssH / zoom;
  ctx.strokeStyle = "rgba(26,24,20,0.05)";
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  const spacing = 28;
  const yStart = Math.floor((camY - viewHalfH) / spacing) * spacing;
  const yEnd = camY + viewHalfH + spacing;
  const xL = camX - viewHalfW - 20;
  const xR = camX + viewHalfW + 20;
  for (let y = yStart; y < yEnd; y += spacing) {
    ctx.moveTo(xL, y);
    ctx.lineTo(xR, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(214,69,61,0.22)";
  ctx.lineWidth = 1.25 / zoom;
  ctx.beginPath();
  ctx.moveTo(64, camY - viewHalfH - 40);
  ctx.lineTo(64, camY + viewHalfH + 40);
  ctx.stroke();

  const pattern = ctx.createPattern(paperGrain(), "repeat");
  if (pattern) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = pattern;
    ctx.fillRect(camX - viewHalfW, camY - viewHalfH, viewHalfW * 2, viewHalfH * 2);
    ctx.restore();
  }

  for (const s of sim.strokes) drawStroke(ctx, s, zoom);
  if (linePreview) {
    drawStroke(
      ctx,
      { id: -1, ink: linePreview.ink, pts: [{ x: linePreview.x0, y: linePreview.y0 }, { x: linePreview.x1, y: linePreview.y1 }] },
      zoom,
    );
  }

  drawFlag(ctx, sim, zoom);

  for (const p of sim.particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.kind === "debris" ? ink : muted;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.kind === "debris" ? 2.2 : 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (!sim.rider.crashed) drawRider(ctx, sim.rider, scarf, sim.time, dt, reduce);
  else if (sim.ragdoll) drawRagdoll(ctx, sim.ragdoll, sim.time);

  ctx.font = `600 ${13 / zoom}px Outfit, sans-serif`;
  ctx.textAlign = "center";
  for (const f of sim.floaters) {
    const a = Math.max(0, f.life / f.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = scarfColor;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  if (eraser) {
    ctx.strokeStyle = "rgba(26,24,20,0.45)";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(eraser.x, eraser.y, 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!reduce) {
    for (const flake of snow) {
      flake.y += flake.v * dt;
      flake.x += flake.drift * dt;
      const sx = ((flake.x - camX * 0.15) % (cssW + 40) + cssW + 40) % (cssW + 40) - 20;
      const sy = ((flake.y) % (cssH + 40) + cssH + 40) % (cssH + 40) - 20;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx, sy, flake.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (sim.flash > 0) {
    ctx.fillStyle = `rgba(243,239,230,${sim.flash * 0.55})`;
    ctx.fillRect(0, 0, cssW, cssH);
  }
}

function drawHill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  zoom: number,
  parallax: number,
  amp: number,
  color: string,
  base: number,
): void {
  ctx.beginPath();
  ctx.moveTo(0, h);
  const yBase = h * base;
  for (let x = 0; x <= w; x += 10) {
    const wx = camX * parallax + (x - w / 2) / zoom;
    const y =
      yBase +
      Math.sin(wx * 0.0031) * amp +
      Math.sin(wx * 0.0105 + 1.2) * amp * 0.35;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  zoom: number,
): void {
  ctx.fillStyle = "rgba(26,24,20,0.13)";
  for (let i = 0; i < 16; i++) {
    const worldX = i * 220 + 40;
    const sx = (worldX - camX * 0.28) * zoom + w / 2;
    const ground =
      h * 0.78 +
      Math.sin(worldX * 0.0031) * 28 +
      Math.sin(worldX * 0.0105 + 1.2) * 10;
    if (sx < -40 || sx > w + 40) continue;
    const ph = 26 + (i % 4) * 10;
    ctx.beginPath();
    ctx.moveTo(sx, ground - ph);
    ctx.lineTo(sx + 10, ground);
    ctx.lineTo(sx - 10, ground);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(sx - 1.4, ground, 2.8, 7);
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, zoom: number): void {
  const pts = s.pts;
  if (pts.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = inkStyle(s.ink);
  ctx.lineWidth = s.ink === "ice" ? 6.5 : 4.4;
  ctx.beginPath();
  const p0 = pts[0];
  if (!p0) return;
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  if (s.ink === "ice") {
    ctx.strokeStyle = palette.iceSheen;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (s.ink === "spring") {
    ctx.strokeStyle = palette.scarf;
    ctx.lineWidth = 1.3;
    for (let i = 1; i < pts.length; i += 2) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.moveTo(mx - nx * 5, my - ny * 5);
      ctx.lineTo(mx + nx * 5, my + ny * 5);
      ctx.stroke();
    }
  } else if (s.ink === "boost") {
    ctx.strokeStyle = palette.scarf;
    ctx.lineWidth = 1.6;
    ctx.fillStyle = palette.scarf;
    for (let i = 1; i < pts.length; i += 3) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.moveTo(mx + tx * 6, my + ty * 6);
      ctx.lineTo(mx - tx * 4 - ty * 4, my - ty * 4 + tx * 4);
      ctx.lineTo(mx - tx * 4 + ty * 4, my - ty * 4 - tx * 4);
      ctx.closePath();
      ctx.fill();
    }
  }
  void zoom;
}

function drawFlag(ctx: CanvasRenderingContext2D, sim: Sim, zoom: number): void {
  const x = sim.flag.x;
  const y = sim.flag.y;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 36);
  ctx.stroke();
  ctx.fillStyle = palette.scarf;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 22, y + 7);
  ctx.lineTo(x, y + 14);
  ctx.closePath();
  ctx.fill();
  if (sim.atStart && !sim.running) {
    ctx.setLineDash([3 / zoom, 4 / zoom]);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(x, y + 36);
    ctx.lineTo(sim.rider.x, sim.rider.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

export function updateScarf(scarf: Scarf, r: Rider, dt: number): void {
  const fx = Math.cos(r.angle);
  const fy = Math.sin(r.angle);
  const ux = r.grounded ? r.gnx : fy;
  const uy = r.grounded ? r.gny : -fx;
  const neckX = r.x + ux * 16 - fx * 1;
  const neckY = r.y + uy * 16 - fy * 1;
  let wx = -r.vx;
  let wy = -r.vy - 20;
  const ws = Math.hypot(wx, wy);
  if (ws > 1) {
    wx /= ws;
    wy /= ws;
  } else {
    wx = -1;
    wy = 0.15;
  }
  if (scarf.length === 0) {
    for (let i = 0; i < 7; i++) scarf.push({ x: neckX + wx * i * 5, y: neckY + wy * i * 5 });
  }
  const head = scarf[0];
  if (head) {
    head.x = neckX;
    head.y = neckY;
  }
  const k = 1 - Math.exp(-14 * dt);
  for (let i = 1; i < scarf.length; i++) {
    const prev = scarf[i - 1];
    const cur = scarf[i];
    if (!prev || !cur) continue;
    const tx = prev.x + wx * 5.5;
    const ty = prev.y + wy * 5.5;
    cur.x += (tx - cur.x) * k;
    cur.y += (ty - cur.y) * k;
  }
}

function drawRider(
  ctx: CanvasRenderingContext2D,
  r: Rider,
  scarf: Scarf,
  time: number,
  dt: number,
  reduce: boolean,
): void {
  if (!reduce) updateScarf(scarf, r, dt);
  const fx = Math.cos(r.angle);
  const fy = Math.sin(r.angle);
  const ux = r.grounded ? r.gnx : fy;
  const uy = r.grounded ? r.gny : -fx;
  const cX = r.x - ux * (RADIUS - 2);
  const cY = r.y - uy * (RADIUS - 2);

  const s0x = cX - fx * 12;
  const s0y = cY - fy * 12;
  const s1x = cX + fx * 14;
  const s1y = cY + fy * 14;
  const noseX = s1x + fx * 5 - ux * 8;
  const noseY = s1y + fy * 5 - uy * 8;

  const lean = clampSafe(-r.omega * 0.035, -0.15, 0.45);
  const hipX = cX - fx * 1 + ux * 3;
  const hipY = cY - fy * 1 + uy * 3;
  const footX = cX + fx * 13 + ux * 1.5;
  const footY = cY + fy * 13 + uy * 1.5;
  const shX = hipX + ux * 15 - fx * (5 + lean * 10);
  const shY = hipY + uy * 15 - fy * (5 + lean * 10);
  const headX = shX + ux * 9 - fx * 1;
  const headY = shY + uy * 9 - fy * 1;
  const wave = Math.sin(time * 9 + r.x * 0.02) * (r.grounded ? 1.2 : 3);
  const a1x = shX - fx * 9 - ux * 1 + wave;
  const a1y = shY - fy * 9 - uy * 1;
  const a2x = shX + fx * 3 + ux * 7;
  const a2y = shY + fy * 3 + uy * 7;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = palette.ink;
  ctx.fillStyle = palette.ink;

  ctx.lineWidth = 3.1;
  ctx.beginPath();
  ctx.moveTo(s0x, s0y);
  ctx.lineTo(s1x, s1y);
  ctx.quadraticCurveTo(s1x + fx * 2, s1y + fy * 2, noseX, noseY);
  ctx.stroke();

  ctx.lineWidth = 2.35;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(footX, footY);
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(shX, shY);
  ctx.moveTo(a1x, a1y);
  ctx.lineTo(shX, shY);
  ctx.lineTo(a2x, a2y);
  ctx.stroke();

  if (scarf.length > 1) {
    ctx.strokeStyle = palette.scarf;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    const s0 = scarf[0];
    if (s0) ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < scarf.length; i++) {
      const p = scarf[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.strokeStyle = palette.ink;
  }

  ctx.beginPath();
  ctx.arc(headX, headY, 5.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.paper;
  ctx.beginPath();
  ctx.arc(headX + fx * 2.2 + ux * 0.3, headY + fy * 2.2 + uy * 0.3, 1.15, 0, Math.PI * 2);
  ctx.fill();
}

function drawRagdoll(ctx: CanvasRenderingContext2D, rag: Ragdoll, time: number): void {
  const d = rag.dots;
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.ink;
  ctx.fillStyle = palette.ink;
  ctx.lineWidth = 2.4;
  const links: [number, number][] = [
    [0, 1],
    [1, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  ctx.beginPath();
  for (const [a, b] of links) {
    const pa = d[a];
    const pb = d[b];
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();
  const sledA = d[7];
  const sledB = d[8];
  if (sledA && sledB) {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sledA.x, sledA.y);
    ctx.lineTo(sledB.x, sledB.y);
    ctx.stroke();
  }
  const head = d[0];
  if (head) {
    ctx.beginPath();
    ctx.arc(head.x, head.y, 5.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = 1.2;
    const s = 2.1;
    ctx.beginPath();
    ctx.moveTo(head.x - s, head.y - s);
    ctx.lineTo(head.x + s, head.y + s);
    ctx.moveTo(head.x + s, head.y - s);
    ctx.lineTo(head.x - s, head.y + s);
    ctx.stroke();
  }
  void time;
}

function clampSafe(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
