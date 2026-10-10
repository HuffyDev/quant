import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { decodeCurve, bondingCurvePda } from "../services/adapters/live/market";
import { assertDebitWithin, assertTreasurySigner } from "../services/txCheck";

describe("pump.fun bonding curve decoding", () => {
  it("decodes reserves and the complete flag", () => {
    const b = Buffer.alloc(49);
    const vals = [1_073_000_000_000_000n, 30_000_000_000n, 793_100_000_000_000n, 0n, 1_000_000_000_000_000n];
    vals.forEach((v, i) => b.writeBigUInt64LE(v, 8 + i * 8));
    b.writeUInt8(1, 48);
    const c = decodeCurve(b);
    expect(c.virtualSolReserves).toBe(30_000_000_000n);
    expect(c.complete).toBe(true);
    const priceSol = Number(c.virtualSolReserves) / 1e9 / (Number(c.virtualTokenReserves) / 1e6);
    expect(priceSol).toBeCloseTo(2.796e-8, 10);
  });
  it("derives a deterministic PDA", () => {
    const m = Keypair.generate().publicKey.toBase58();
    expect(bondingCurvePda(m).toBase58()).toBe(bondingCurvePda(m).toBase58());
  });
});

describe("executor preflight", () => {
  it("bounds the simulated treasury debit", () => {
    expect(assertDebitWithin(10e9, 10e9 - 0.2e9 - 0.005e9, 0.2)).toBeCloseTo(0.205);
    expect(() => assertDebitWithin(10e9, 9e9, 0.2)).toThrow(/refusing/);
  });
  it("requires the treasury to sign", () => {
    const a = Keypair.generate();
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: a.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message());
    expect(() => assertTreasurySigner(tx, a.publicKey.toBase58())).not.toThrow();
    expect(() => assertTreasurySigner(tx, Keypair.generate().publicKey.toBase58())).toThrow();
  });
});
