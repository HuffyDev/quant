import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { actions, proposals } from "../db/schema";
import { LIMITS } from "../config/limits";
import { evaluate, type GuardianResult, type GuardianState } from "./guardian";
import { requireCap } from "./capabilities";
import { ageS } from "./clock";
import { emit, markDirty } from "./events";
import { getSettings } from "./settings";
import { treasurySol } from "./solana";
import { executeBuyback } from "./executor";

export type ProposalRow = typeof proposals.$inferSelect;

const pid = (id: number) => `#${String(id).padStart(3, "0")}`;

export async function guardianState(): Promise<GuardianState> {
  const spends = await db
    .select({ ageS: actions.ageS, sol: actions.amountSol })
    .from(actions)
    .where(and(eq(actions.type, "BUYBACK"), eq(actions.status, "CONFIRMED")));
  return {
    nowAgeS: ageS() ?? 0,
    treasurySol: (await treasurySol()) ?? 0,
    spends: spends.map((s) => ({ ageS: s.ageS ?? 0, sol: s.sol ?? 0 })),
    treasuryFrozen: getSettings().treasuryFrozen,
  };
}

/** Public, non-secret view of the limits Baby can be told about after a rejection. */
export function publicLimits() {
  return {
    max_buyback_sol_per_tx: LIMITS.MAX_BUYBACK_SOL_PER_TX,
    max_spend_sol_per_hour: LIMITS.MAX_SPEND_SOL_PER_HOUR,
    min_treasury_reserve_sol: LIMITS.MIN_TREASURY_RESERVE_SOL,
    min_seconds_between_buybacks: LIMITS.MIN_SECONDS_BETWEEN_BUYBACKS,
    max_slippage_bps: LIMITS.MAX_SLIPPAGE_BPS,
  };
}

/**
 * Record a proposal from Baby. `fixed` is the scheduled first buyback (T+4), which exists before PROPOSE_ACTION.
 */
export async function createProposal(
  p: { type: string; amountSol: number; slippageBps: number; reasons: string[]; confidence: number; parentId?: number | null },
  opts: { fixed?: boolean } = {},
): Promise<ProposalRow> {
  if (opts.fixed) requireCap("EXECUTE_BUYBACK");
  else requireCap("PROPOSE_ACTION");
  const [row] = await db
    .insert(proposals)
    .values({
      type: p.type,
      amount: Math.round(p.amountSol * 1e4) / 1e4,
      slippageBps: Math.round(p.slippageBps),
      reasons: p.reasons.slice(0, 5).map((r) => r.slice(0, 200)),
      confidence: Math.max(0, Math.min(1, p.confidence)),
      parentId: p.parentId ?? null,
      ageS: ageS(),
    })
    .returning();
  await emit({
    type: "DECISION",
    source: "BABY",
    message: `proposal ${pid(row.id)}: ${row.type} ${row.amount} SOL (confidence ${Math.round(row.confidence * 100)}%) — ${row.reasons.join("; ")}`,
    data: { proposalId: row.id, amount: row.amount, slippageBps: row.slippageBps, parentId: row.parentId },
  });
  markDirty();
  return row;
}

/** Guardian review. Rejections are always public with reason + max allowed. */
export async function reviewProposal(id: number): Promise<{ row: ProposalRow; result: GuardianResult }> {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);
  if (!p) throw new Error(`proposal ${id} not found`);
  if (p.status !== "PENDING") throw new Error(`proposal ${pid(id)} is ${p.status}`);
  const result = evaluate({ type: p.type, amountSol: p.amount, slippageBps: p.slippageBps }, await guardianState());
  const status = result.approved ? "APPROVED" : "REJECTED";
  const [row] = await db
    .update(proposals)
    .set({ status, guardianResult: status, guardianReason: result.reason, maxAllowed: result.maxAllowed })
    .where(eq(proposals.id, id))
    .returning();
  await emit({
    type: "GUARDIAN",
    source: "GUARDIAN",
    message: result.approved
      ? `proposal ${pid(id)} APPROVED — ${p.amount} SOL within all limits`
      : `proposal ${pid(id)} REJECTED — ${result.reason} · max allowed now ${result.maxAllowed} SOL`,
    data: { proposalId: id, approved: result.approved, maxAllowed: result.maxAllowed, checks: result.checks },
  });
  markDirty();
  return { row, result };
}

/** Execute an APPROVED proposal through the executor. */
export async function executeProposal(id: number) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);
  if (!p || p.status !== "APPROVED") throw new Error(`proposal ${id} is not approved`);
  const res = await executeBuyback({ proposalId: p.id, amountSol: p.amount, slippageBps: p.slippageBps });
  await db.update(proposals).set({ status: res.ok ? "EXECUTED" : "FAILED" }).where(eq(proposals.id, id));
  markDirty();
  return res;
}

export async function latestPending() {
  const [p] = await db.select().from(proposals).where(eq(proposals.status, "PENDING")).orderBy(desc(proposals.id)).limit(1);
  return p ?? null;
}

export async function recentProposals(limit = 5) {
  return db.select().from(proposals).orderBy(desc(proposals.id)).limit(limit);
}

export { pid as proposalLabel };
