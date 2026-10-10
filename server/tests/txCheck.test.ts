import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assertFeePayer, assertProgramsAllowed } from "../services/txCheck";

const payer = Keypair.generate();
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

function tx(ixs: TransactionInstruction[], feePayer = payer.publicKey) {
  const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg);
}

describe("executor program whitelist", () => {
  it("accepts compute budget + pump.fun", () => {
    const t = tx([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), new TransactionInstruction({ programId: PUMP, keys: [], data: Buffer.alloc(8) })]);
    expect(assertProgramsAllowed(t)).toEqual(["ComputeBudget", "pump.fun"]);
  });

  it("refuses a transaction touching an unknown program", () => {
    const evil = Keypair.generate().publicKey;
    const t = tx([new TransactionInstruction({ programId: evil, keys: [], data: Buffer.alloc(1) })]);
    expect(() => assertProgramsAllowed(t)).toThrow(/non-whitelisted/);
  });

  it("refuses when a whitelisted ix is mixed with an unknown one", () => {
    const t = tx([new TransactionInstruction({ programId: PUMP, keys: [], data: Buffer.alloc(8) }), new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(1) })]);
    expect(() => assertProgramsAllowed(t)).toThrow();
  });

  it("system transfers are a System-program ix (allowed program) but fee payer must be the treasury", () => {
    const t = tx([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })]);
    expect(() => assertFeePayer(t, payer.publicKey.toBase58())).not.toThrow();
    expect(() => assertFeePayer(t, Keypair.generate().publicKey.toBase58())).toThrow(/fee payer/);
  });
});
