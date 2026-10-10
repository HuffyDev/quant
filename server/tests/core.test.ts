import { describe, expect, it } from "vitest";
import { clusterPins, hash32 } from "../../client/src/core/cluster";

describe("/core clustering", () => {
  it("merges pins in the same cell and keeps distant ones apart", () => {
    const c = clusterPins([{ i: 0, x: 10, y: 10 }, { i: 1, x: 14, y: 12 }, { i: 2, x: 300, y: 300 }], 28);
    expect(c).toHaveLength(2);
    const big = c.find((x) => x.members.length === 2)!;
    expect(big.members.sort()).toEqual([0, 1]);
    expect(big.x).toBeCloseTo(12);
    expect(big.y).toBeCloseTo(11);
  });
  it("splits as pins spread out (zooming in)", () => {
    const near = Array.from({ length: 20 }, (_, i) => ({ i, x: 100 + i, y: 100 }));
    const far = near.map((p) => ({ ...p, x: 100 + p.i * 40 }));
    expect(clusterPins(near, 28).length).toBeLessThan(3);
    expect(clusterPins(far, 28).length).toBe(20);
  });
  it("hash is deterministic and spreads", () => {
    expect(hash32(42)).toBe(hash32(42));
    expect(new Set(Array.from({ length: 1000 }, (_, i) => hash32(i) % 97)).size).toBeGreaterThan(90);
  });
});
