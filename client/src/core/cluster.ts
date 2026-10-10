/** Screen-space pin clustering for /core. Pure: no DOM, no three.js. */

export interface ScreenPin {
  /** index into the caller's pin array */
  i: number;
  x: number;
  y: number;
}

export interface Cluster {
  x: number;
  y: number;
  members: number[];
}

/**
 * Greedy grid clustering: pins whose screen positions fall in the same `cell`-px square merge into one marker at
 * their centroid. As the camera zooms in, pins spread apart on screen and clusters split on their own.
 */
export function clusterPins(pins: ScreenPin[], cell: number): Cluster[] {
  const grid = new Map<string, Cluster>();
  for (const p of pins) {
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const c = grid.get(key);
    if (c) {
      const n = c.members.length;
      c.x = (c.x * n + p.x) / (n + 1);
      c.y = (c.y * n + p.y) / (n + 1);
      c.members.push(p.i);
    } else grid.set(key, { x: p.x, y: p.y, members: [p.i] });
  }
  return [...grid.values()];
}

/** Stable integer hash (for deterministic pin placement). */
export function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
