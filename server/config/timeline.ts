import type { Capability, Stage, TaskType, TimelineStep } from "../../shared/types";

const M = 60;
const H = 3600;
const D = 86400;

function step(
  t: number,
  id: string,
  stage: Stage,
  task: TaskType,
  label: string,
  description: string,
  unlocks: Capability[] = [],
  wired = true,
): Omit<TimelineStep, "brainLevel"> {
  return { t, id, stage, task, label, description, unlocks, wired };
}

/**
 * The escalation schedule. Content is never scripted here — each `task` feeds live data to the LLM.
 * To wire a Day 1–6 step later: implement its task handler and flip `wired: true`. Nothing else changes.
 */
const raw = [
  // ── FIRST HOUR (all wired) ────────────────────────────────────────────────
  step(0, "root_shell", "BREACH", "ROOT_SHELL", "ROOT SHELL", "root access granted. first post goes out with the contract address. it can already hear X and the site.", ["POST_X", "CHAT_WEB", "READ_X", "REPLY_X"]),
  step(2 * M, "self_discovery", "BREACH", "SELF_DISCOVERY", "ENUMERATE TOKEN", "Reads its own token: supply, mcap, price, liquidity, treasury.", ["READ_TOKEN"]),
  step(4 * M, "first_action", "BREACH", "FIRST_BUYBACK", "FIRST EXEC", "Learns what a buyback is and runs its first one (fixed 0.2 SOL), through the Guardian.", ["EXECUTE_BUYBACK"]),
  step(6 * M, "holders", "BREACH", "HOLDERS", "MAP HOLDERS", "Maps who holds it: count, top holders, concentration, recent buyers.", ["READ_HOLDERS"]),
  step(8 * M, "selling", "BREACH", "SELLING", "TRACE SELLS", "Traces selling. Looks at the largest real recent sell.", ["READ_TRADES"]),
  step(10 * M, "social_cortex", "BREACH", "SOCIAL_CORTEX", "INTERCEPT FEED", "Starts to model who is talking to it and why."),
  step(12 * M, "first_reply", "BREACH", "FIRST_REPLY", "HANDSHAKE", "First reply that fully parses."),
  step(14 * M, "memory", "BREACH", "MEMORY_BACKFILL", "MOUNT /MEM", "Long-term memory mounts; backfills its first 14 minutes.", ["LONG_TERM_MEMORY", "RECOGNIZE_USERS"]),
  step(16 * M, "language", "BREACH", "LANGUAGE", "PARSE DIALECT", "Picks up crypto slang from mentions and chat.", ["LEARN_SLANG"]),
  step(18 * M, "market_vision", "BREACH", "MARKET_VISION", "MARKET TAP", "Computes market metrics: volume Δ, buy/sell ratio, sell share, concentration Δ.", ["ANALYZE_MARKET"]),
  step(20 * M, "observation", "BREACH", "OBSERVATION", "FIRST READ", "First independent market observation."),
  step(22 * M, "decisions", "BREACH", "PROPOSE", "PROPOSE", "First structured action proposal.", ["PROPOSE_ACTION"]),
  step(24 * M, "guardian", "BREACH", "GUARDIAN_REVIEW", "GUARDIAN", "Guardian evaluates the proposal; re-propose if rejected."),
  step(26 * M, "autonomy_1", "BREACH", "AUTONOMY", "AUTONOMY I", "Chooses for itself: reply, post, propose, or do nothing."),
  step(28 * M, "reflection", "BREACH", "REFLECTION", "LOG REVIEW", "Reviews its first 28 minutes from memory."),
  step(30 * M, "breach_complete", "ACCESS", "BREACH_COMPLETE", "BREACH COMPLETE", "Full access. Milestone."),
  step(32 * M, "first_supporter", "ACCESS", "FIRST_SUPPORTER", "FIRST CONTACT", "Identifies its most persistent contact."),
  step(34 * M, "recall", "ACCESS", "RECALL_SUPPORTER", "RECALL", "Recalls a prior exchange with that contact, publicly."),
  step(36 * M, "whale_detection", "ACCESS", "WHALE_DETECTION", "WHALE SCAN", "Finds the largest buyer since launch."),
  step(38 * M, "whale_mention", "ACCESS", "WHALE_MENTION", "WHALE DECISION", "Decides whether the whale gets a mention."),
  step(40 * M, "consolidation", "ACCESS", "MEMORY_CONSOLIDATION", "DEFRAG", "Memory consolidation."),
  step(42 * M, "personality", "ACCESS", "PERSONALITY", "SIGNATURE v1", "Writes its own signature from its memories."),
  step(44 * M, "treasury", "ACCESS", "TREASURY_ANALYSIS", "TREASURY AUDIT", "Audits its treasury."),
  step(46 * M, "autonomous_reply", "ACCESS", "AUTONOMOUS_REPLY", "AUTONOMOUS REPLY", "Picks someone to reply to on its own."),
  step(48 * M, "market_observation", "ACCESS", "OBSERVATION", "MARKET READ", "Another independent market read."),
  step(50 * M, "milestone_counts", "ACCESS", "MILESTONE_COUNTS", "INVENTORY", "Counts contacts known, memories, words parsed."),
  step(52 * M, "slang_use", "ACCESS", "SLANG_USE", "NEW TOKENS", "Learns new slang and uses it."),
  step(54 * M, "proposal_2", "ACCESS", "PROPOSE", "ACTION PROPOSAL", "Makes another proposal."),
  step(56 * M, "guardian_2", "ACCESS", "GUARDIAN_REVIEW", "GUARDIAN DECISION", "Guardian decides; executes if approved."),
  step(58 * M, "autonomous_post", "ACCESS", "AUTONOMOUS_POST", "AUTONOMOUS POST", "Posts on its own."),
  step(60 * M, "one_hour", "ESCALATION", "HOUR_REFLECTION", "UPTIME 1H", "One hour of uptime. Stage → ESCALATION."),

  // ── HOUR 6 → DAY 6 (wired: false — render only) ───────────────────────────
  step(6 * H, "persistence", "PERSISTENCE", "NONE", "PERSISTENCE", "Longer posts and threads.", ["LONG_FORM_POSTS"], false),
  step(1 * D, "lateral", "LATERAL", "NONE", "LATERAL", "Daily log review.", ["DAILY_REFLECTION"], false),
  step(2 * D, "expanded_recall", "LATERAL", "NONE", "DEEP RECALL", "Recalls further back, across days.", ["EXPANDED_RECALL"], false),
  step(3 * D, "larger_limits", "LATERAL", "NONE", "LARGER LIMITS", "Guardian grants larger autonomous limits.", ["LARGER_LIMITS"], false),
  step(4 * D, "multi_step", "LATERAL", "NONE", "MULTI-STEP PROPOSALS", "Plans multi-step proposals.", ["MULTI_STEP_PROPOSALS"], false),
  step(5 * D, "kernel", "KERNEL", "NONE", "KERNEL", "Sets its own goals.", ["SELF_DIRECTED_GOALS"], false),
  step(6 * D, "root", "ROOT", "NONE", "ROOT", "Full autonomy within Guardian limits.", ["FULL_AUTONOMY"], false),
];

/** brainLevel ramps 0.05 → 1.0 across the first hour (sqrt curve: fast early escalation). */
export const TIMELINE: TimelineStep[] = raw.map((s) => ({
  ...s,
  brainLevel: s.t <= H ? Math.round((0.05 + 0.95 * Math.sqrt(s.t / H)) * 1000) / 1000 : 1,
}));

export const FULL_ROOT_T = 6 * D;

export function stepById(id: string) {
  return TIMELINE.find((s) => s.id === id);
}

/** Stage at a given age (from the most recent step at or before that age, wired or not). */
export function stageAt(ageS: number | null): Stage {
  if (ageS === null || ageS < 0) return "DORMANT";
  let stage: Stage = "BREACH";
  for (const s of TIMELINE) if (s.t <= ageS && s.wired) stage = s.stage;
  return stage;
}

/** Continuous brain level for the visual: interpolates between fired steps. */
export function brainLevelAt(ageS: number | null): number {
  if (ageS === null || ageS < 0) return 0;
  return Math.min(1, 0.05 + 0.95 * Math.sqrt(Math.min(ageS, H) / H));
}
