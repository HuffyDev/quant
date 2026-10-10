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

describe("/core pins", async () => {
  const { pinFromEvent, proofLabel } = await import("../../shared/pins");
  const ev = (type: string, source: string, data: Record<string, unknown> | null = null, message = "m", proofUrl: string | null = null) =>
    ({ id: 1, ts: "2026-10-10T00:00:00Z", ageS: 60, type, source, message, data, proofUrl }) as Parameters<typeof pinFromEvent>[0];
  it.each([
    [ev("ARC", "ROOT"), "arc", "BREACH"],
    [ev("BOOT", "ROOT"), "arc", "BREACH"],
    [ev("SOCIAL", "SYSTEM", { postId: "1", text: "t" }), "x_post", "SOCIAL"],
    [ev("SOCIAL", "SYSTEM", { postId: "1", mentionId: "2", text: "t" }), "x_reply", "SOCIAL"],
    [ev("ACTION", "SYSTEM", { sig: "abc" }), "buyback", "TREASURY"],
    [ev("MEMORY", "ROOT"), "memory", "MEMORY"],
    [ev("DECISION", "ROOT", { proposalId: 3 }), "proposal", "DECISIONS"],
    [ev("MARKET", "ROOT"), "market", "MARKET"],
    [ev("GUARDIAN", "GUARDIAN", { approved: false }), "guardian_reject", "DECISIONS"],
    [ev("LEARN", "ROOT"), "language", "LANGUAGE"],
    [ev("WARNING", "SYSTEM"), "system", "MEMORY"],
  ])("maps %#", (e, kind, region) => {
    const p = pinFromEvent(e);
    expect([p.kind, p.region]).toEqual([kind, region]);
    expect(p.red).toBe(kind === "guardian_reject");
  });
  it("uses the post text and labels proof links", () => {
    expect(pinFromEvent(ev("SOCIAL", "SYSTEM", { postId: "1", text: "hello" }, "posted to X")).content).toBe("hello");
    expect(proofLabel("https://x.com/root/status/1")).toBe("View on X");
    expect(proofLabel("https://solscan.io/tx/abc")).toBe("View on Solscan");
  });
});
