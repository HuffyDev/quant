import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { actions } from "../db/schema";
import { isSim } from "../env";
import { evaluate } from "./guardian";
import { guardianState } from "./proposals";
import { requireCap } from "./capabilities";
import { ageS } from "./clock";
import { emit, markDirty } from "./events";
import { getSettings } from "./settings";
import { getAdapters } from "./adapters";

/**
 * The executor. The ONLY module allowed to sign. In MODE=live it is also the only module that reads
 * TREASURY_PRIVATE_KEY (see adapters/live/executor.ts, which is only imported from here).
 */
export async function executeBuyback(p: { proposalId: number | null; amountSol: number; slippageBps: number }) {
  requireCap("EXECUTE_BUYBACK");
  const age = ageS() ?? 0;

  // Defence in depth: kill switch + Guardian re-check immediately before signing.
  if (getSettings().treasuryFrozen) return fail(p, age, "treasury frozen by operator");
  const g = evaluate({ type: "BUYBACK", amountSol: p.amountSol, slippageBps: p.slippageBps }, await guardianState());
  if (!g.approved) return fail(p, age, `guardian re-check failed: ${g.reason}`);

  await emit({ type: "ACTION", source: "SYSTEM", message: `executor: buying back ${p.amountSol} SOL (slippage ≤ ${p.slippageBps} bps)${isSim ? " [sim]" : ""}`, data: { proposalId: p.proposalId } });
  try {
    const res = await getAdapters().executor.buyback(p.amountSol, p.slippageBps);
    const [row] = await db
      .insert(actions)
      .values({ type: "BUYBACK", status: "CONFIRMED", amountSol: p.amountSol, tokensOut: res.tokensOut, txSig: res.sig, proofUrl: res.proofUrl, proposalId: p.proposalId, summary: `buyback ${p.amountSol} SOL${res.tokensOut ? ` → ${Math.round(res.tokensOut).toLocaleString()} tokens` : ""}`, ageS: age })
      .returning();
    await emit({ type: "ACTION", source: "SYSTEM", message: `BUYBACK confirmed: ${p.amountSol} SOL → ${res.tokensOut ? Math.round(res.tokensOut).toLocaleString() : "?"} tokens`, data: { actionId: row.id, sig: res.sig, proposalId: p.proposalId }, proofUrl: res.proofUrl });
    markDirty();
    return { ok: true as const, sig: res.sig, proofUrl: res.proofUrl, tokensOut: res.tokensOut, actionId: row.id };
  } catch (e) {
    return fail(p, age, e instanceof Error ? e.message : String(e));
  }
}

async function fail(p: { proposalId: number | null; amountSol: number }, age: number, reason: string) {
  const [row] = await db.insert(actions).values({ type: "BUYBACK", status: "FAILED", amountSol: p.amountSol, proposalId: p.proposalId, summary: `failed: ${reason}`, ageS: age }).returning();
  // no tx exists for a failed buyback — the proof link points at the public failure record
  await db.update(actions).set({ proofUrl: `/proof/action/${row.id}` }).where(eq(actions.id, row.id));
  await emit({ type: "WARNING", source: "SYSTEM", message: `buyback NOT executed: ${reason}`, data: { proposalId: p.proposalId } });
  markDirty();
  return { ok: false as const, reason };
}
