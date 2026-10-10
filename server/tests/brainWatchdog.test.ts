import { describe, expect, it } from "vitest";
import { DEAD_FOR_MS, FpsSampler, QualityGovernor, SLOW_FOR_MS, WARMUP_MS } from "../../client/src/brain/watchdog";

/** Feed `fps` frames per second for `ms` starting at `t`; returns the closed windows and the end time. */
function run(s: FpsSampler, t: number, ms: number, fps: number) {
  const out: { fps: number; ms: number }[] = [];
  const step = 1000 / fps;
  const end = t + ms;
  for (; t < end; t += step) {
    const w = s.frame(t);
    if (w) out.push(w);
  }
  return { out, t };
}

describe("FpsSampler", () => {
  it("measures nothing during the 3s warm-up after load", () => {
    const s = new FpsSampler();
    expect(run(s, 0, WARMUP_MS - 10, 5).out).toEqual([]);
  });

  it("restarts the warm-up after a reset (tab switch, resume, quality change)", () => {
    const s = new FpsSampler();
    const a = run(s, 0, 6000, 60);
    expect(a.out.length).toBeGreaterThan(0);
    expect(a.out.every((w) => Math.abs(w.fps - 60) < 2)).toBe(true);
    s.reset(a.t);
    expect(run(s, a.t, WARMUP_MS - 10, 10).out).toEqual([]);
  });

  it("closes ~1s windows with the frame rate", () => {
    const s = new FpsSampler();
    const { out } = run(s, 0, WARMUP_MS + 5200, 20);
    expect(out.length).toBe(5);
    for (const w of out) {
      expect(w.fps).toBeCloseTo(20, 0);
      expect(w.ms).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe("QualityGovernor", () => {
  const feed = (g: QualityGovernor, fps: number, seconds: number, atLowest = false) => {
    const v: string[] = [];
    for (let i = 0; i < seconds; i++) v.push(g.window(fps, 1000, atLowest));
    return v;
  };

  it("needs sustained <30fps for 4s before dropping a level", () => {
    const g = new QualityGovernor(true);
    expect(feed(g, 25, SLOW_FOR_MS / 1000 - 1)).toEqual(["ok", "ok", "ok"]);
    expect(g.window(25, 1000, false)).toBe("drop");
  });

  it("forgives dips: one good window clears the slow streak", () => {
    const g = new QualityGovernor(true);
    const v = [...feed(g, 20, 3), ...feed(g, 45, 1), ...feed(g, 20, 3)];
    expect(v).not.toContain("drop");
  });

  it("is not triggered by 30–50fps (the old watchdog dropped below 50)", () => {
    expect(feed(new QualityGovernor(true), 35, 60)).not.toContain("drop");
  });

  it("mobile / no WebGL2: gives up only on the lowest level after sustained slowness", () => {
    const g = new QualityGovernor(true);
    expect(feed(g, 20, 4, true)).toEqual(["ok", "ok", "ok", "give-up"]);
  });

  it("desktop WebGL2: never gives up for merely slow frames, only when truly failing", () => {
    const g = new QualityGovernor(false);
    expect(feed(g, 12, 120, true)).not.toContain("give-up");
    const dead = feed(g, 3, DEAD_FOR_MS / 1000, true);
    expect(dead.at(-1)).toBe("give-up");
    expect(dead.slice(0, -1)).not.toContain("give-up");
  });

  it("steps down level by level: a drop resets the streak", () => {
    const g = new QualityGovernor(false);
    const v = feed(g, 20, 8);
    expect(v.filter((x) => x === "drop").length).toBe(2);
    expect(v[3]).toBe("drop");
    expect(v[7]).toBe("drop");
  });
});
