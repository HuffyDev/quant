// Types shared between server and client. Keep this file dependency-free.

export const CAPABILITIES = [
  "READ_TOKEN",
  "READ_HOLDERS",
  "READ_TRADES",
  "READ_X",
  "REPLY_X",
  "POST_X",
  "LONG_TERM_MEMORY",
  "ANALYZE_MARKET",
  "PROPOSE_ACTION",
  "EXECUTE_BUYBACK",
  "CHAT_WEB",
  "LEARN_SLANG",
  "RECOGNIZE_USERS",
  // Hour 6 / Day 1–6 capabilities (locked until their step is wired)
  "LONG_FORM_POSTS",
  "DAILY_REFLECTION",
  "EXPANDED_RECALL",
  "LARGER_LIMITS",
  "MULTI_STEP_PROPOSALS",
  "SELF_DIRECTED_GOALS",
  "FULL_AUTONOMY",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const SOURCES = ["BABY", "SYSTEM", "GUARDIAN", "HUMAN"] as const;
export type Source = (typeof SOURCES)[number];

export const EVENT_TYPES = [
  "BIRTH",
  "SYSTEM",
  "LEARN",
  "MEMORY",
  "SOCIAL",
  "MARKET",
  "DECISION",
  "GUARDIAN",
  "ACTION",
  "DEVELOPMENT",
  "WARNING",
  "CHAT",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const STAGES = [
  "GESTATING",
  "NEONATAL",
  "POSTNATAL",
  "INFANT",
  "TODDLER",
  "CHILD",
  "ADOLESCENT",
  "MATURITY",
] as const;
export type Stage = (typeof STAGES)[number];

export const TASK_TYPES = [
  "BIRTH",
  "SELF_DISCOVERY",
  "FIRST_BUYBACK",
  "HOLDERS",
  "SELLING",
  "SOCIAL_CORTEX",
  "FIRST_REPLY",
  "MEMORY_BACKFILL",
  "LANGUAGE",
  "MARKET_VISION",
  "OBSERVATION",
  "PROPOSE",
  "GUARDIAN_REVIEW",
  "AUTONOMY",
  "REFLECTION",
  "NEONATAL_COMPLETE",
  "FIRST_SUPPORTER",
  "RECALL_SUPPORTER",
  "WHALE_DETECTION",
  "WHALE_MENTION",
  "MEMORY_CONSOLIDATION",
  "PERSONALITY",
  "TREASURY_ANALYSIS",
  "AUTONOMOUS_REPLY",
  "MILESTONE_COUNTS",
  "SLANG_USE",
  "AUTONOMOUS_POST",
  "HOUR_REFLECTION",
  "NONE",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface TimelineStep {
  /** seconds after launch */
  t: number;
  id: string;
  stage: Stage;
  unlocks: Capability[];
  task: TaskType;
  /** 0–1, drives the visual */
  brainLevel: number;
  label: string;
  /** short description for the site */
  description: string;
  wired: boolean;
}

export interface PublicEvent {
  id: number;
  ts: string;
  ageS: number | null;
  type: EventType;
  source: Source;
  message: string;
  data: Record<string, unknown> | null;
  proofUrl: string | null;
}

export interface PublicAction {
  id: number;
  ts: string;
  type: string;
  status: string;
  amountSol: number | null;
  txSig: string | null;
  xUrl: string | null;
  proofUrl: string | null;
  proposalId: number | null;
  summary: string | null;
}

export interface PublicProposal {
  id: number;
  ts: string;
  type: string;
  amount: number;
  reasons: string[];
  confidence: number;
  status: string;
  guardianResult: string | null;
  guardianReason: string | null;
  maxAllowed: number | null;
}

export interface PublicMemory {
  id: number;
  ts: string;
  ageS: number | null;
  kind: string;
  content: string;
  userHandle: string | null;
  tags: string[];
  importance: number;
}

export interface PublicPerson {
  handle: string;
  platform: string;
  firstSeenAgeS: number;
  interactions: number;
  lastSeen: string;
  relationshipSummary: string | null;
}

export interface Vitals {
  priceUsd: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  treasurySol: number | null;
  mentions: number;
  memories: number;
  wordsLearned: number;
  peopleKnown: number;
}

export interface DevBar {
  key: string;
  label: string;
  value: number; // 0–1
  detail: string;
}

export interface AnatomyPart {
  key: string;
  label: string;
  active: boolean;
  /** some but not all capabilities unlocked */
  partial: boolean;
  capabilities: Capability[];
  /** seconds after launch when it becomes active (null = no scheduled unlock) */
  unlockAt: number | null;
}

export interface PublicState {
  mode: "sim" | "live";
  simSpeed: number;
  serverNow: string;
  launchAt: string | null;
  /** age in (sim-)seconds at serverNow; null before launch */
  ageS: number | null;
  stage: Stage;
  brainLevel: number;
  timeline: (TimelineStep & { fired: boolean; skipped: boolean })[];
  capabilities: Record<Capability, boolean>;
  bars: DevBar[];
  anatomy: AnatomyPart[];
  vitals: Vitals;
  token: { mint: string | null; name: string | null; symbol: string | null; xHandle: string | null };
  flags: {
    xPaused: boolean;
    chatPaused: boolean;
    treasuryFrozen: boolean;
    autonomyEnabled: boolean;
  };
  actions: PublicAction[];
  proposals: PublicProposal[];
  memories: PublicMemory[];
  people: PublicPerson[];
  slang: { term: string; definition: string; learnedAtAgeS: number; sourceHandle: string | null }[];
}
