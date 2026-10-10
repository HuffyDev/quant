import { LIMITS } from "../config/limits";

/**
 * The Guardian. Pure, deterministic, no LLM, no I/O. Unit-tested in guardian.test.ts.
 * All times are in baby-seconds (sim-accelerated in MODE=sim, real seconds in live).
 */

export interface ProposalInput {
  type: string;
  amountSol: number;
  slippageBps: number;
}

export interface GuardianState {
  nowAgeS: number;
  treasurySol: number;
  /** confirmed buyback spends: [ageS, sol] */
  spends: { ageS: number; sol: number }[];
  treasuryFrozen: boolean;
}

export interface GuardianResult {
  approved: boolean;
  reason: string;
  /** the largest amount that WOULD be approved right now (0 if nothing is) */
  maxAllowed: number;
  checks: { name: string; ok: boolean; detail: string }[];
}

export type Limits = typeof LIMITS;

const r4 = (v: number) => Math.floor(v * 1e4) / 1e4;

export function evaluate(p: ProposalInput, s: GuardianState, limits: Limits = LIMITS): GuardianResult {
  const checks: GuardianResult["checks"] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const spentHour = s.spends.filter((x) => x.ageS > s.nowAgeS - 3600).reduce((a, x) => a + x.sol, 0);
  const spentDay = s.spends.filter((x) => x.ageS > s.nowAgeS - 86400).reduce((a, x) => a + x.sol, 0);
  const last = s.spends.reduce((m, x) => Math.max(m, x.ageS), -Infinity);
  const sinceLast = s.nowAgeS - last;
  const cooldownOk = !isFinite(last) || sinceLast >= limits.MIN_SECONDS_BETWEEN_BUYBACKS;

  const headroom = Math.max(
    0,
    Math.min(
      limits.MAX_BUYBACK_SOL_PER_TX,
      limits.MAX_SPEND_SOL_PER_HOUR - spentHour,
      limits.MAX_SPEND_SOL_PER_DAY - spentDay,
      s.treasurySol - limits.MIN_TREASURY_RESERVE_SOL - limits.FEE_BUFFER_SOL,
    ),
  );
  const maxAllowed = s.treasuryFrozen || !cooldownOk ? 0 : r4(headroom);

  add("frozen", !s.treasuryFrozen, s.treasuryFrozen ? "treasury frozen by operator" : "treasury not frozen");
  add("action", (limits.ALLOWED_ACTIONS as readonly string[]).includes(p.type), `action: ${p.type} (allowed: ${limits.ALLOWED_ACTIONS.join(", ")})`);
  const finite = Number.isFinite(p.amountSol) && Number.isFinite(p.slippageBps);
  add("amount", finite && p.amountSol > 0, `amount: ${p.amountSol} SOL (must be > 0)`);
  add("per_tx", p.amountSol <= limits.MAX_BUYBACK_SOL_PER_TX, `per-tx: ${p.amountSol} SOL (max ${limits.MAX_BUYBACK_SOL_PER_TX})`);
  add("per_hour", spentHour + p.amountSol <= limits.MAX_SPEND_SOL_PER_HOUR + 1e-9, `hourly: ${r4(spentHour)} spent + ${p.amountSol} (max ${limits.MAX_SPEND_SOL_PER_HOUR}/h)`);
  add("per_day", spentDay + p.amountSol <= limits.MAX_SPEND_SOL_PER_DAY + 1e-9, `daily: ${r4(spentDay)} spent + ${p.amountSol} (max ${limits.MAX_SPEND_SOL_PER_DAY}/day)`);
  add(
    "reserve",
    s.treasurySol - p.amountSol - limits.FEE_BUFFER_SOL >= limits.MIN_TREASURY_RESERVE_SOL - 1e-9,
    `reserve: treasury ${r4(s.treasurySol)} − ${p.amountSol} must stay ≥ ${limits.MIN_TREASURY_RESERVE_SOL} SOL`,
  );
  add("cooldown", cooldownOk, isFinite(last) ? `cooldown: ${Math.floor(sinceLast)}s since last buyback (min ${limits.MIN_SECONDS_BETWEEN_BUYBACKS}s)` : "cooldown: no previous buyback");
  add("slippage", p.slippageBps > 0 && p.slippageBps <= limits.MAX_SLIPPAGE_BPS, `slippage: ${p.slippageBps} bps (max ${limits.MAX_SLIPPAGE_BPS})`);

  const failed = checks.filter((c) => !c.ok);
  return {
    approved: failed.length === 0,
    reason: failed.length === 0 ? "all checks passed" : failed.map((c) => c.detail).join("; "),
    maxAllowed,
    checks,
  };
}
