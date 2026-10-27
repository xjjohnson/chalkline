export type Ink = "slope" | "ice" | "spring" | "boost";

export type Pt = { x: number; y: number };

export type Stroke = {
  id: number;
  ink: Ink;
  pts: Pt[];
};

export type Track = {
  name: string;
  flag: Pt;
  strokes: Stroke[];
};

export const RADIUS = 10;
export const GRAVITY = 1080;
export const MAX_SPEED = 2700;
export const PX_PER_M = 36;
export const TAU = Math.PI * 2;

export const MU: Record<Ink, number> = {
  slope: 0.045,
  ice: 0.004,
  spring: 0.07,
  boost: 0.02,
};

export const REST: Record<Ink, number> = {
  slope: 0.04,
  ice: 0.02,
  spring: 0.78,
  boost: 0.05,
};

export const BOOST_ACCEL = 1550;

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return d;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
