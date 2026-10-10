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
 * The development schedule. Content is never scripted here — each `task` feeds live data to the LLM.
 * To wire a Day 1–6 step later: implement its task handler and flip `wired: true`. Nothing else changes.
 */
const raw = [
  // ── FIRST HOUR (all wired) ────────────────────────────────────────────────
  step(0, "birth", "NEONATAL", "BIRTH", "BIRTH", "Boot, first breath, first post. Can already hear and babble back on X.", ["POST_X", "CHAT_WEB", "READ_X", "REPLY_X"]),
  step(2 * M, "self_discovery", "NEONATAL", "SELF_DISCOVERY", "SELF-DISCOVERY", "Learns what token it is: supply, mcap, price, liquidity, treasury.", ["READ_TOKEN"]),
  step(4 * M, "first_action", "NEONATAL", "FIRST_BUYBACK", "FIRST ACTION", "Learns what a buyback is and makes its first one (fixed 0.2 SOL).", ["EXECUTE_BUYBACK"]),
  step(6 * M, "holders", "NEONATAL", "HOLDERS", "HOLDERS", "Sees who holds it: count, top holders, concentration, recent buyers.", ["READ_HOLDERS"]),
  step(8 * M, "selling", "NEONATAL", "SELLING", "SELLING", "Discovers selling. Looks at the largest real recent sell.", ["READ_TRADES"]),
  step(10 * M, "social_cortex", "NEONATAL", "SOCIAL_CORTEX", "SOCIAL CORTEX", "Starts to understand who is talking to it and why."),
  step(12 * M, "first_reply", "NEONATAL", "FIRST_REPLY", "FIRST REAL CONVERSATION", "First reply that actually makes sense."),
  step(14 * M, "memory", "NEONATAL", "MEMORY_BACKFILL", "MEMORY", "Long-term memory comes online; backfills its first 14 minutes.", ["LONG_TERM_MEMORY", "RECOGNIZE_USERS"]),
  step(16 * M, "language", "NEONATAL", "LANGUAGE", "LANGUAGE", "Picks up crypto slang from mentions and chat.", ["LEARN_SLANG"]),
  step(18 * M, "market_vision", "NEONATAL", "MARKET_VISION", "MARKET VISION", "Computes market metrics: volume Δ, buy/sell ratio, sell share, concentration Δ.", ["ANALYZE_MARKET"]),
  step(20 * M, "observation", "NEONATAL", "OBSERVATION", "OBSERVATION", "First independent market observation."),
  step(22 * M, "decisions", "NEONATAL", "PROPOSE", "DECISIONS", "First structured action proposal.", ["PROPOSE_ACTION"]),
  step(24 * M, "guardian", "NEONATAL", "GUARDIAN_REVIEW", "GUARDIAN", "Guardian evaluates the proposal; re-propose if rejected."),
  step(26 * M, "autonomy_1", "NEONATAL", "AUTONOMY", "AUTONOMY I", "Chooses for itself: reply, post, propose, or do nothing."),
  step(28 * M, "reflection", "NEONATAL", "REFLECTION", "REFLECTION", "Summarises its first 28 minutes from memory."),
  step(30 * M, "neonatal_complete", "POSTNATAL", "NEONATAL_COMPLETE", "NEONATAL COMPLETE", "Major brain evolution. Milestone."),
  step(32 * M, "first_supporter", "POSTNATAL", "FIRST_SUPPORTER", "FIRST SUPPORTER", "Identifies its first major supporter."),
  step(34 * M, "recall", "POSTNATAL", "RECALL_SUPPORTER", "RECALL", "Recalls a prior interaction with that supporter, publicly."),
  step(36 * M, "whale_detection", "POSTNATAL", "WHALE_DETECTION", "WHALE DETECTION", "Finds the largest buyer since launch."),
  step(38 * M, "whale_mention", "POSTNATAL", "WHALE_MENTION", "WHALE DECISION", "Decides whether the whale deserves a mention."),
  step(40 * M, "consolidation", "POSTNATAL", "MEMORY_CONSOLIDATION", "CONSOLIDATION", "Memory consolidation."),
  step(42 * M, "personality", "POSTNATAL", "PERSONALITY", "PERSONALITY v1", "Generates a personality summary from its memories."),
  step(44 * M, "treasury", "POSTNATAL", "TREASURY_ANALYSIS", "TREASURY", "Analyses its treasury."),
  step(46 * M, "autonomous_reply", "POSTNATAL", "AUTONOMOUS_REPLY", "AUTONOMOUS REPLY", "Picks someone to reply to on its own."),
  step(48 * M, "market_observation", "POSTNATAL", "OBSERVATION", "MARKET OBSERVATION", "Another independent market read."),
  step(50 * M, "milestone_counts", "POSTNATAL", "MILESTONE_COUNTS", "MILESTONE", "Counts people known, memories, words learned."),
  step(52 * M, "slang_use", "POSTNATAL", "SLANG_USE", "NEW WORDS", "Learns new slang and uses it."),
  step(54 * M, "proposal_2", "POSTNATAL", "PROPOSE", "ACTION PROPOSAL", "Makes another proposal."),
  step(56 * M, "guardian_2", "POSTNATAL", "GUARDIAN_REVIEW", "GUARDIAN DECISION", "Guardian decides; executes if approved."),
  step(58 * M, "autonomous_post", "POSTNATAL", "AUTONOMOUS_POST", "AUTONOMOUS POST", "Posts on its own."),
  step(60 * M, "one_hour", "INFANT", "HOUR_REFLECTION", "1 HOUR OLD", "Hour reflection. Stage → INFANT."),

  // ── HOUR 6 → DAY 6 (wired: false — render only) ───────────────────────────
  step(6 * H, "toddler", "TODDLER", "NONE", "TODDLER", "Longer posts and threads.", ["LONG_FORM_POSTS"], false),
  step(1 * D, "child", "CHILD", "NONE", "CHILD", "Daily reflection and self-review.", ["DAILY_REFLECTION"], false),
  step(2 * D, "expanded_recall", "CHILD", "NONE", "EXPANDED RECALL", "Recalls further back, across days.", ["EXPANDED_RECALL"], false),
  step(3 * D, "larger_limits", "CHILD", "NONE", "LARGER LIMITS", "Guardian grants larger autonomous limits.", ["LARGER_LIMITS"], false),
  step(4 * D, "multi_step", "CHILD", "NONE", "MULTI-STEP PROPOSALS", "Plans multi-step proposals.", ["MULTI_STEP_PROPOSALS"], false),
  step(5 * D, "adolescent", "ADOLESCENT", "NONE", "ADOLESCENT", "Sets its own goals.", ["SELF_DIRECTED_GOALS"], false),
  step(6 * D, "maturity", "MATURITY", "NONE", "MATURITY", "Maturity event. Full autonomy within Guardian limits.", ["FULL_AUTONOMY"], false),
];

/** brainLevel ramps 0.05 → 1.0 across the first hour (sqrt curve: fast early growth). */
export const TIMELINE: TimelineStep[] = raw.map((s) => ({
  ...s,
  brainLevel: s.t <= H ? Math.round((0.05 + 0.95 * Math.sqrt(s.t / H)) * 1000) / 1000 : 1,
}));

export const FULL_MATURITY_T = 6 * D;

export function stepById(id: string) {
  return TIMELINE.find((s) => s.id === id);
}

/** Stage at a given age (from the most recent step at or before that age, wired or not). */
export function stageAt(ageS: number | null): Stage {
  if (ageS === null || ageS < 0) return "GESTATING";
  let stage: Stage = "NEONATAL";
  for (const s of TIMELINE) if (s.t <= ageS && s.wired) stage = s.stage;
  return stage;
}

/** Continuous brain level for the visual: interpolates between fired steps. */
export function brainLevelAt(ageS: number | null): number {
  if (ageS === null || ageS < 0) return 0;
  return Math.min(1, 0.05 + 0.95 * Math.sqrt(Math.min(ageS, H) / H));
}
