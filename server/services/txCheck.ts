import { VersionedTransaction } from "@solana/web3.js";
import { ALLOWED_PROGRAMS } from "../config/limits";

/**
 * Executor safety check: every top-level instruction in a built transaction must invoke a whitelisted program.
 * (Program ids cannot come from address lookup tables, so static account keys are sufficient.)
 */
export function programIdsOf(tx: VersionedTransaction): string[] {
  const keys = tx.message.staticAccountKeys;
  return [...new Set(tx.message.compiledInstructions.map((ix) => {
    const k = keys[ix.programIdIndex];
    if (!k) throw new Error(`instruction program index ${ix.programIdIndex} is not a static key`);
    return k.toBase58();
  }))];
}

export function assertProgramsAllowed(tx: VersionedTransaction, allowed: Record<string, string> = ALLOWED_PROGRAMS) {
  const ids = programIdsOf(tx);
  const bad = ids.filter((id) => !(id in allowed));
  if (bad.length) throw new Error(`refusing to sign: transaction touches non-whitelisted program(s) ${bad.join(", ")}`);
  return ids.map((id) => allowed[id]);
}

/**
 * Executor safety check: the transaction may only debit the treasury by roughly the approved amount.
 * Verified via simulation in the live executor; this helper checks the fee payer is the treasury.
 */
export function assertFeePayer(tx: VersionedTransaction, treasury: string) {
  const payer = tx.message.staticAccountKeys[0]?.toBase58();
  if (payer !== treasury) throw new Error(`refusing to sign: fee payer ${payer} is not the treasury`);
}

/** The treasury must be one of the transaction's required signers (it may not be the fee payer for gasless routes). */
export function assertTreasurySigner(tx: VersionedTransaction, treasury: string) {
  const n = tx.message.header.numRequiredSignatures;
  const signers = tx.message.staticAccountKeys.slice(0, n).map((k) => k.toBase58());
  if (!signers.includes(treasury)) throw new Error("refusing to sign: treasury is not a required signer of this transaction");
}

/** Max SOL the treasury may lose in one buyback beyond the approved amount (fees, priority fee, ATA rent). */
export const DEBIT_HEADROOM_SOL = 0.03;

export function assertDebitWithin(preLamports: number, postLamports: number, approvedSol: number) {
  const debit = (preLamports - postLamports) / 1e9;
  if (debit > approvedSol + DEBIT_HEADROOM_SOL) throw new Error(`refusing to sign: simulation debits ${debit.toFixed(4)} SOL, approved ${approvedSol} (+${DEBIT_HEADROOM_SOL} headroom)`);
  return debit;
}
