/**
 * Procedural brain: pure math, no DOM / three.js. Used as the fallback point cloud when /models/brain.glb is
 * missing, and by scripts/make-placeholders.ts to build the placeholder GLB. Coordinates: x lateral, y up,
 * z front (+Z faces the viewer, like glTF), roughly within [-1, 1].
 */

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type V3 = [number, number, number];

/** Cortex surface point for a unit direction on one hemisphere (side = -1 | 1). */
export function cortexPoint(dx: number, dy: number, dz: number, side: number): V3 {
  // gyri / sulci: layered folds
  const g =
    0.055 * Math.sin(9 * dy + 5 * dz + side) * Math.sin(11 * dz - 4 * dx) +
    0.03 * Math.sin(17 * dx + 13 * dy - 7 * dz) +
    0.018 * Math.sin(29 * dz + 23 * dy);
  const r = 1 + g;
  let x = dx * 0.5 * r;
  let y = dy * 0.6 * r;
  const z = dz * 0.86 * r;
  // flatten the base, bulge the temporal lobes down and out
  if (y < -0.18) y = -0.18 + (y + 0.18) * 0.55;
  const temporal = Math.max(0, -dy) * Math.max(0, 1 - Math.abs(dz - 0.15) * 1.6);
  x += side * temporal * 0.08 * Math.abs(dx);
  y -= temporal * 0.06;
  // offset each hemisphere from the midline; flatten the medial wall to leave a thin longitudinal fissure
  x += side * 0.38;
  if (x * side < 0.025) x = side * 0.025;
  return [x, y + 0.1, z];
}

export function cerebellumPoint(dx: number, dy: number, dz: number): V3 {
  const stri = 1 + 0.045 * Math.sin(42 * dy + 3 * dx);
  return [dx * 0.46 * stri, -0.4 + dy * 0.2 * stri, -0.56 + dz * 0.28 * stri];
}

export function stemPoint(u: number, a: number): V3 {
  const y = -0.3 - u * 0.62;
  const r = 0.11 - u * 0.025;
  return [Math.cos(a) * r, y, -0.2 - u * 0.12 + Math.sin(a) * r];
}

function unitDir(rand: () => number): V3 {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(t), z, s * Math.sin(t)];
}

export interface PointSet {
  positions: Float32Array;
  inner: Uint8Array;
  count: number;
}

/** Sample a procedural brain point cloud (surface + interior). Order is shuffled: any prefix is an even sample. */
export function proceduralBrain(count: number, seed = 7): PointSet {
  const rand = rng(seed);
  const positions = new Float32Array(count * 3);
  const inner = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const k = rand();
    let p: V3;
    if (k < 0.74) {
      const side = rand() < 0.5 ? -1 : 1;
      let d = unitDir(rand);
      // fewer points on the hidden medial wall
      if (d[0] * side < -0.5 && rand() < 0.7) d = [-d[0], d[1], d[2]];
      p = cortexPoint(d[0], d[1], d[2], side);
    } else if (k < 0.86) {
      const d = unitDir(rand);
      p = cerebellumPoint(d[0], d[1], d[2]);
    } else if (k < 0.9) {
      p = stemPoint(rand(), rand() * Math.PI * 2);
    } else {
      // interior: a surface point pulled toward the core
      const side = rand() < 0.5 ? -1 : 1;
      const d = unitDir(rand);
      const s = 0.2 + rand() * 0.45;
      const c = cortexPoint(d[0], d[1], d[2], side);
      p = [c[0] * s, c[1] * s - 0.04, c[2] * s];
      inner[i] = 1;
    }
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }
  return { positions, inner, count };
}
