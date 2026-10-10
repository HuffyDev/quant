import type { BabyOutput } from "./llm";
import { createProposal, executeProposal, publicLimits, reviewProposal, proposalLabel, type ProposalRow } from "./proposals";
import { runTask } from "./orchestrator";
import { treasurySol } from "./solana";

export type FlowResult =
  | { status: "executed"; proposal: ProposalRow; sig: string; proofUrl: string; tokensOut: number | null }
  | { status: "failed"; proposal: ProposalRow; reason: string }
  | { status: "rejected"; proposal: ProposalRow; reason: string; maxAllowed: number };

/** Guardian review → execute if approved; if rejected, Baby may re-propose once within limits. */
export async function reviewAndExecute(id: number, allowRetry: boolean): Promise<FlowResult> {
  const { row, result } = await reviewProposal(id);
  if (result.approved) {
    const ex = await executeProposal(id);
    return ex.ok ? { status: "executed", proposal: row, sig: ex.sig, proofUrl: ex.proofUrl, tokensOut: ex.tokensOut } : { status: "failed", proposal: row, reason: ex.reason };
  }
  if (!allowRetry || result.maxAllowed <= 0) return { status: "rejected", proposal: row, reason: result.reason, maxAllowed: result.maxAllowed };

  const r = await runTask({
    task: "GUARDIAN_REVIEW",
    instruction:
      "The Guardian rejected your proposal. Read its reason and the maximum it would allow right now. Either re-propose ONE buyback that fits inside the limits (set `action`), or set action to null and say why you'd rather wait. Say something short about being rejected.",
    data: {
      rejected_proposal: { id: proposalLabel(row.id), amount_sol: row.amount, reasons: row.reasons },
      rejection: { reason: result.reason, max_allowed: result.maxAllowed },
      limits: publicLimits(),
      treasury_sol: await treasurySol(),
    },
    allow: { propose: true },
    eventType: "DECISION",
  });
  if (!r?.out.action) return { status: "rejected", proposal: row, reason: result.reason, maxAllowed: result.maxAllowed };
  const child = await createProposal({ ...toProposal(r.out.action), parentId: row.id });
  return reviewAndExecute(child.id, false);
}

export function toProposal(a: NonNullable<BabyOutput["action"]>) {
  return { type: a.type, amountSol: a.amount_sol, slippageBps: a.slippage_bps, reasons: a.reasons, confidence: a.confidence };
}

/** Compact, model-friendly description of a flow outcome. */
export function describeFlow(f: FlowResult) {
  if (f.status === "executed") return { result: "executed", proposal: proposalLabel(f.proposal.id), amount_sol: f.proposal.amount, tokens_received: f.tokensOut ? Math.round(f.tokensOut) : null, proof: "transaction is linked on the site" };
  if (f.status === "failed") return { result: "failed", proposal: proposalLabel(f.proposal.id), reason: f.reason };
  return { result: "rejected by guardian", proposal: proposalLabel(f.proposal.id), reason: f.reason, max_allowed: f.maxAllowed };
}
