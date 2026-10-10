import { describe, expect, it } from "vitest";
import { requireCap, CapabilityLockedError, hasCap } from "../services/capabilities";
import { SimWorld } from "../services/adapters/sim/world";
import { TIMELINE, stageAt } from "../config/timeline";

describe("capability gating", () => {
  it("a locked capability throws", () => {
    expect(hasCap("EXECUTE_BUYBACK")).toBe(false);
    expect(() => requireCap("EXECUTE_BUYBACK")).toThrow(CapabilityLockedError);
  });
});

describe("timeline", () => {
  it("has 31 wired first-hour steps and 7 locked day steps with unique ids", () => {
    expect(TIMELINE.filter((s) => s.wired && s.t <= 3600)).toHaveLength(31);
    expect(TIMELINE.filter((s) => !s.wired)).toHaveLength(7);
    expect(new Set(TIMELINE.map((s) => s.id)).size).toBe(TIMELINE.length);
    for (const s of TIMELINE.filter((s) => !s.wired)) expect(s.unlocks.length).toBeGreaterThan(0);
  });
  it("stage progression", () => {
    expect(stageAt(null)).toBe("GESTATING");
    expect(stageAt(0)).toBe("NEONATAL");
    expect(stageAt(1800)).toBe("POSTNATAL");
    expect(stageAt(3600)).toBe("INFANT");
    expect(stageAt(86400 * 6)).toBe("INFANT"); // day steps are not wired yet
  });
});

describe("sim world", () => {
  it("is deterministic for a seed and replays treasury buys identically", () => {
    const a = new SimWorld(7);
    const b = new SimWorld(7);
    a.advance(600);
    a.treasuryBuy(0.2, 650, "X");
    a.advance(1200);
    b.treasuryBuy(0.2, 650, "X");
    b.advance(1200);
    expect(a.priceSol).toBeCloseTo(b.priceSol, 15);
    expect(a.holderList().length).toBe(b.holderList().length);
    expect(a.treasurySol).toBeCloseTo(b.treasurySol, 12);
  });
  it("contains the scripted dump before T+8 and whale before T+36", () => {
    const w = new SimWorld(1337);
    w.advance(480);
    const sells = w.applied.filter((t) => t.side === "sell").sort((x, y) => y.sol - x.sol);
    expect(sells[0].wallet).toBe(w.dumperWallet);
    w.advance(2160);
    expect(w.applied.some((t) => t.wallet === w.whaleWallet && t.sol === 12)).toBe(true);
  });
  it("refuses to overspend the sim treasury", () => {
    expect(() => new SimWorld(1).treasuryBuy(1000, 10)).toThrow();
  });
});
