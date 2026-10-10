import { desc, eq, gt, and, ne } from "drizzle-orm";
import { db } from "../db/client";
import { actions, mentions, trades } from "../db/schema";
import { AUTONOMY } from "../config/limits";
import type { TaskType } from "../../shared/types";
import { DECISIONS } from "./llm";
import { hasCap } from "./capabilities";
import { ageS, realMs } from "./clock";
import { emit } from "./events";
import { runTask } from "./orchestrator";
import { computeMetrics, latestSnapshot } from "./market";
import { postToX, replyOnX, topMentions } from "./social";
import { createProposal, guardianState, latestPending, recentProposals } from "./proposals";
import { evaluate } from "./guardian";
import { reviewAndExecute, describeFlow, toProposal } from "./flows";
import { getSettings } from "./settings";
import { firedMap } from "./engine";
import { queue } from "./queue";
import { resetHooks } from "./resetHooks";

type Decision = (typeof DECISIONS)[number];

async function context() {
  const age = ageS() ?? 0;
  const candidates = hasCap("READ_X")
    ? (await topMentions(5, { unrepliedOnly: true, sinceAge: age - 900 })).map((m) => ({ id: m.id, handle: m.handle, text: m.text, followers: m.followers, rank: m.rank }))
    : [];
  const market = hasCap("ANALYZE_MARKET") ? await computeMetrics() : null;
  const snap = await latestSnapshot();
  const myPosts = await db.select({ summary: actions.summary, ageS: actions.ageS, type: actions.type }).from(actions).where(ne(actions.type, "BUYBACK")).orderBy(desc(actions.id)).limit(4);
  const g = evaluate({ type: "BUYBACK", amountSol: 0.0001, slippageBps: 100 }, await guardianState());
  const lastPost = myPosts.find((p) => p.type === "X_POST");
  const lastReply = myPosts.find((p) => p.type === "X_REPLY");
  return {
    candidates,
    market: market ?? (snap ? { mcap_usd: snap.mcap, holders: snap.holders } : null),
    my_recent_posts: myPosts.map((p) => ({ text: p.summary, seconds_ago: p.ageS !== null ? age - p.ageS : null })),
    recent_proposals: (await recentProposals(3)).map((p) => ({ id: p.id, amount: p.amount, status: p.status, guardian: p.guardianReason })),
    guardian_max_allowed_now: g.maxAllowed,
    can_post_now: !lastPost || age - (lastPost.ageS ?? 0) >= AUTONOMY.MIN_SECONDS_BETWEEN_AUTONOMOUS_POSTS,
    can_reply_now: !lastReply || age - (lastReply.ageS ?? 0) >= AUTONOMY.MIN_SECONDS_BETWEEN_REPLIES,
  };
}

/**
 * Baby chooses: IGNORE / REMEMBER / RESPOND / POST / ANALYZE / PROPOSE. Code then enforces caps and the Guardian.
 */
export async function decideAndAct(opts: { task: TaskType | "AUTONOMY_LOOP"; instruction: string; forced?: Decision; extra?: Record<string, unknown> }) {
  const ctx = await context();
  // a scheduled proposal awaiting Guardian review blocks new ones (keeps T+22 → T+24 coherent)
  const pending = await latestPending();
  const allow = { post: hasCap("POST_X"), reply: hasCap("REPLY_X"), propose: hasCap("PROPOSE_ACTION") && !pending, remember: true };
  const r = await runTask({
    task: opts.task,
    instruction: opts.instruction,
    data: { ...ctx, ...opts.extra, ...(pending ? { proposal_awaiting_guardian: pending.id, note: "you cannot PROPOSE until it is reviewed" } : {}), ...(opts.forced ? { forced_decision: opts.forced } : {}) },
    allow,
    eventType: "DECISION",
    memoryQuery: { handle: ctx.candidates[0]?.handle, tags: ["market", "decision"] },
  });
  if (!r) return null;
  const out = r.out;
  const decision: Decision = out.decision ?? (opts.forced ?? "IGNORE");

  switch (decision) {
    case "RESPOND": {
      const target = ctx.candidates.find((c) => c.id === out.reply_to_mention_id) ?? (opts.forced === "RESPOND" ? ctx.candidates[0] : undefined);
      if (!target || !out.say) {
        await emit({ type: "DECISION", source: "SYSTEM", message: "RESPOND chosen but no valid mention/text — nothing sent" });
        break;
      }
      const res = await replyOnX(target.id, out.say);
      if (!res.ok) await emit({ type: "DECISION", source: "SYSTEM", message: `reply not sent: ${res.reason}` });
      break;
    }
    case "POST": {
      if (!out.say) break;
      const res = await postToX(out.say, { autonomous: true });
      if (!res.ok) await emit({ type: "DECISION", source: "SYSTEM", message: `post not sent: ${res.reason}` });
      break;
    }
    case "PROPOSE": {
      if (!out.action || !allow.propose) {
        await emit({ type: "DECISION", source: "SYSTEM", message: "PROPOSE chosen without a valid proposal — skipped" });
        break;
      }
      const p = await createProposal(toProposal(out.action));
      const flow = await reviewAndExecute(p.id, false);
      await emit({ type: "ACTION", source: "SYSTEM", message: `proposal flow: ${JSON.stringify(describeFlow(flow))}` });
      break;
    }
    case "ANALYZE":
      if (ctx.market) await emit({ type: "MARKET", source: "SYSTEM", message: "analysis inputs logged", data: { metrics: ctx.market } });
      break;
    default:
      break; // IGNORE / REMEMBER: memories already stored by the orchestrator
  }
  return { decision, out };
}

// ── background loop (from T+12): every 45–90 baby-seconds ──
let timer: NodeJS.Timeout | null = null;
let last: { price: number | null; holders: number | null; age: number } | null = null;
resetHooks.push(() => {
  last = null;
});

async function meaningfulChange(): Promise<string[]> {
  const age = ageS() ?? 0;
  const snap = await latestSnapshot();
  const reasons: string[] = [];
  const since = last?.age ?? age - 90;
  if (hasCap("READ_X")) {
    const fresh = await db.select({ id: mentions.id }).from(mentions).where(and(gt(mentions.ageS, since), eq(mentions.minorFlag, false), gt(mentions.rank, 0.45))).limit(3);
    if (fresh.length) reasons.push(`${fresh.length} new relevant mention(s)`);
  }
  if (last?.price && snap?.price) {
    const d = (snap.price - last.price) / last.price;
    if (Math.abs(d) >= 0.05) reasons.push(`price ${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%`);
  }
  if (last?.holders != null && snap?.holders != null && Math.abs(snap.holders - last.holders) >= 5) reasons.push(`holders ${last.holders}→${snap.holders}`);
  const big = await db.select().from(trades).where(and(gt(trades.ageS, since), gt(trades.sol, 1.5), eq(trades.isTreasury, false))).limit(1);
  if (big.length) reasons.push(`large ${big[0].side} ${big[0].sol.toFixed(2)} SOL`);
  last = { price: snap?.price ?? last?.price ?? null, holders: snap?.holders ?? last?.holders ?? null, age };
  return reasons;
}

export function startAutonomyLoop() {
  if (timer) return;
  const schedule = () => {
    const babyS = AUTONOMY.MIN_INTERVAL_S + Math.random() * (AUTONOMY.MAX_INTERVAL_S - AUTONOMY.MIN_INTERVAL_S);
    timer = setTimeout(tick, Math.max(500, realMs(babyS)));
  };
  const tick = () => {
    const ready = firedMap().has("first_reply") && getSettings().autonomyEnabled;
    if (ready && !queue.busy) {
      queue.push("autonomy", async () => {
        const reasons = await meaningfulChange();
        if (!reasons.length) return; // observe → nothing meaningful → ignore silently
        await emit({ type: "SYSTEM", source: "SYSTEM", message: `autonomous loop: observed ${reasons.join(", ")}` });
        await decideAndAct({
          task: "AUTONOMY_LOOP",
          instruction:
            "Something changed (see `observed`). Choose exactly one decision: IGNORE, REMEMBER, RESPOND (reply to one candidate mention), POST (a new X post), ANALYZE, or PROPOSE (a buyback). Doing nothing is a valid, often wise choice. Respect can_post_now / can_reply_now.",
          extra: { observed: reasons },
        });
      });
    }
    schedule();
  };
  schedule();
}
