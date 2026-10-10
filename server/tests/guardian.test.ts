import { describe, expect, it } from "vitest";
import { evaluate, type GuardianState } from "../services/guardian";
import { LIMITS } from "../config/limits";

const base: GuardianState = { nowAgeS: 3600, treasurySol: 10, spends: [], treasuryFrozen: false };
const buy = (amountSol: number, slippageBps = 300) => ({ type: "BUYBACK", amountSol, slippageBps });

describe("guardian", () => {
  it("approves a normal buyback", () => {
    const r = evaluate(buy(0.2), base);
    expect(r.approved).toBe(true);
    expect(r.maxAllowed).toBeCloseTo(0.5);
  });

  it("rejects oversized per-tx amounts and reports max allowed", () => {
    const r = evaluate(buy(0.8), base);
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/per-tx/);
    expect(r.maxAllowed).toBe(LIMITS.MAX_BUYBACK_SOL_PER_TX);
  });

  it("rejects buybacks inside the cooldown", () => {
    const r = evaluate(buy(0.2), { ...base, spends: [{ ageS: 3600 - 100, sol: 0.2 }] });
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/cooldown/);
    expect(r.maxAllowed).toBe(0);
  });

  it("allows again once the cooldown has passed", () => {
    expect(evaluate(buy(0.2), { ...base, spends: [{ ageS: 3600 - 240, sol: 0.2 }] }).approved).toBe(true);
  });

  it("enforces the hourly cap", () => {
    // 1.8 SOL already spent in the last hour (cooldown satisfied)
    const spends = [1500, 1000, 700, 300].map((ago) => ({ ageS: 3600 - ago, sol: 0.45 }));
    const r = evaluate(buy(0.3), { ...base, spends });
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/hourly/);
    expect(r.maxAllowed).toBeCloseTo(0.2, 3);
    // spends older than an hour do not count
    expect(evaluate(buy(0.3), { ...base, spends: spends.map((s) => ({ ...s, ageS: s.ageS - 3600 })) }).approved).toBe(true);
  });

  it("enforces the daily cap", () => {
    const spends = Array.from({ length: 10 }, (_, i) => ({ ageS: i * 7200, sol: 0.5 })); // 5 SOL over the day
    const r = evaluate(buy(0.1), { ...base, nowAgeS: 80000, spends });
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/daily/);
  });

  it("never breaks the treasury reserve", () => {
    const r = evaluate(buy(0.5), { ...base, treasurySol: 3.3 });
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/reserve/);
    expect(r.maxAllowed).toBeLessThan(0.3);
    expect(evaluate(buy(r.maxAllowed), { ...base, treasurySol: 3.3 }).approved).toBe(true);
  });

  it("rejects everything when the treasury is frozen", () => {
    const r = evaluate(buy(0.1), { ...base, treasuryFrozen: true });
    expect(r.approved).toBe(false);
    expect(r.maxAllowed).toBe(0);
  });

  it("rejects non-BUYBACK actions", () => {
    for (const type of ["TRANSFER", "SELL", "APPROVE", "MINT"]) expect(evaluate({ type, amountSol: 0.1, slippageBps: 100 }, base).approved).toBe(false);
  });

  it("rejects zero, negative, NaN and Infinity amounts", () => {
    for (const a of [0, -1, NaN, Infinity]) expect(evaluate(buy(a), base).approved).toBe(false);
  });

  it("rejects excessive slippage", () => {
    expect(evaluate(buy(0.1, LIMITS.MAX_SLIPPAGE_BPS + 1), base).approved).toBe(false);
    expect(evaluate(buy(0.1, 0), base).approved).toBe(false);
  });

  it("is deterministic", () => {
    expect(evaluate(buy(0.3), base)).toEqual(evaluate(buy(0.3), base));
  });
});
