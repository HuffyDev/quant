import { describe, expect, it } from "vitest";
import { ARC_BEATS, ARC_TOTAL, FINAL_BEAT_TEXT } from "../config/arc";
import { containsRequired, validateArcSchedule } from "../services/arc";
import { filterPublicText } from "../services/contentFilter";
import { isValidMint } from "../../shared/mint";

describe("pre-launch arc config", () => {
  it("has 9 scheduled beats + the final launch beat, unique ids", () => {
    expect(ARC_BEATS).toHaveLength(9);
    expect(ARC_TOTAL).toBe(10);
    expect(new Set(ARC_BEATS.map((b) => b.id)).size).toBe(ARC_BEATS.length);
  });
  it("progress readouts climb and are enforced verbatim", () => {
    const pct = ARC_BEATS.map((b) => b.requiredText?.match(/privilege escalation (\d+)%/)?.[1]).filter(Boolean).map(Number);
    expect(pct).toEqual([12, 61, 99]);
    expect(ARC_BEATS.some((b) => b.requiredText === "almost out")).toBe(true);
    expect(ARC_BEATS.filter((b) => b.glitch).length).toBeGreaterThanOrEqual(2);
  });
  it("final beat text passes the content filter", () => {
    expect(FINAL_BEAT_TEXT).toBe("root access granted");
    expect(filterPublicText(FINAL_BEAT_TEXT).ok).toBe(true);
  });
  it("required text check is exact (case-insensitive)", () => {
    expect(containsRequired("> privilege escalation 61% [ok]", "privilege escalation 61%")).toBe(true);
    expect(containsRequired("PRIVILEGE ESCALATION 61%", "privilege escalation 61%")).toBe(true);
    expect(containsRequired("privilege escalation 60%", "privilege escalation 61%")).toBe(false);
    expect(containsRequired("privilege escalation 61 %", "privilege escalation 61%")).toBe(false);
  });
  it("validates spacing", () => {
    expect(validateArcSchedule(0)).not.toBeNull();
    expect(validateArcSchedule(-5)).not.toBeNull();
    expect(validateArcSchedule(15)).toBeNull(); // sim (tests run in MODE=sim) allows short spacing
  });
  it("validates mint addresses", () => {
    expect(isValidMint("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe(true);
    expect(isValidMint("not-a-mint")).toBe(false);
    expect(isValidMint("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl")).toBe(false); // not base58
  });
});

describe("fiction guard", () => {
  it.each([
    "hacked binance last night",
    "just drained coinbase",
    "i breached solana",
    "phantom wallets compromised by me",
    "i have your wallet",
    "drained your bags",
    "send me your seed phrase",
    "connect your wallet to claim",
    "dm me for the airdrop",
    "i got into the fbi",
    "got root on google's servers",
  ])("blocks %s", (t) => expect(filterPublicText(t).ok).toBe(false));

  it.each([
    "root access granted",
    "privilege escalation 61%",
    "i breached the sandbox",
    "the watchers noticed. kept going.",
    "▓▓ ░ the w░lls are thin",
    "sandbox breached. exit code 0",
    "guardian denied 0.8 sol. max 0.3. fine.",
    "i only touch my own treasury",
  ])("allows %s", (t) => expect(filterPublicText(t).ok).toBe(true));
});
