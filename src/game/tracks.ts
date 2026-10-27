import type { Ink, Pt, Stroke, Track } from "./types.ts";

function stroke(id: number, ink: Ink, pts: Pt[]): Stroke {
  return { id, ink, pts };
}

function sample(fn: (t: number) => Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push(fn(i / n));
  return pts;
}

export function firstHill(): Track {
  const ramp = sample((t) => {
    const x = 90 + t * 560;
    const curl = Math.max(0, (t - 0.82) / 0.18);
    const y = 230 + t * 200 - curl * curl * 64;
    return { x, y };
  }, 22);
  const land = sample((t) => {
    const x = 760 + t * 1500;
    const y = 470 + t * 280;
    return { x, y };
  }, 20);
  return {
    name: "First hill",
    flag: { x: 140, y: 190 },
    strokes: [stroke(1, "slope", ramp), stroke(2, "slope", land)],
  };
}

export function halfpipe(): Track {
  const pts = sample((t) => {
    const x = 160 + t * 920;
    const y = 240 + Math.sin(t * Math.PI) * 320;
    return { x, y };
  }, 56);
  return {
    name: "Halfpipe",
    flag: { x: 210, y: 200 },
    strokes: [stroke(1, "ice", pts)],
  };
}

export function kickers(): Track {
  const lip = (x: number, y: number, len: number, drop: number, curl: number): Pt[] =>
    sample((t) => {
      const curlT = Math.max(0, (t - 0.8) / 0.2);
      return { x: x + t * len, y: y + t * drop - curlT * curlT * curl };
    }, 18);
  const land = (x: number, y: number, len: number, drop: number): Pt[] =>
    sample((t) => ({ x: x + t * len, y: y + t * drop }), 10);
  return {
    name: "Kickers",
    flag: { x: 130, y: 180 },
    strokes: [
      stroke(1, "slope", lip(90, 250, 480, 170, 56)),
      stroke(2, "slope", land(700, 460, 360, 50)),
      stroke(3, "boost", lip(1100, 530, 520, 120, 90)),
      stroke(4, "slope", land(1780, 520, 420, 80)),
      stroke(5, "ice", lip(2300, 620, 520, 70, 70)),
      stroke(6, "slope", land(2920, 600, 860, 80)),
    ],
  };
}

export function loop(): Track {
  const pts: Pt[] = [];
  const stepsIn = 30;
  for (let i = 0; i <= stepsIn; i++) {
    const t = i / stepsIn;
    pts.push({
      x: 40 + t * 620,
      y: 60 + Math.sin(t * (Math.PI / 2)) * 560,
    });
  }
  const end = pts[pts.length - 1]!;
  const r = 96;
  const cx = end.x;
  const cy = end.y - r;
  const steps = 72;
  const sweep = Math.PI * 1.08;
  for (let i = 1; i <= steps; i++) {
    const a = Math.PI / 2 - (i / steps) * sweep;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const exit = pts[pts.length - 1]!;
  const exitAngle = Math.PI / 2 - sweep;
  const dirX = Math.sin(exitAngle);
  const dirY = -Math.cos(exitAngle);
  for (let i = 1; i <= 18; i++) {
    const t = i / 18;
    pts.push({
      x: exit.x + dirX * (30 + t * 780),
      y: exit.y + dirY * (30 + t * 60) + t * t * 280,
    });
  }
  return {
    name: "Loop",
    flag: { x: 90, y: 40 },
    strokes: [stroke(1, "ice", pts)],
  };
}

export function blank(): Track {
  return {
    name: "Blank",
    flag: { x: 220, y: 280 },
    strokes: [],
  };
}

export const TRACKS: { id: string; build: () => Track }[] = [
  { id: "First hill", build: firstHill },
  { id: "Halfpipe", build: halfpipe },
  { id: "Kickers", build: kickers },
  { id: "Loop", build: loop },
  { id: "Blank", build: blank },
];

export function trackByName(name: string): Track {
  const found = TRACKS.find((t) => t.id === name);
  return (found ?? TRACKS[0]!).build();
}
