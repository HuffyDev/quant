import { desc, sql } from "drizzle-orm";
import { db } from "../db/client";
import * as t from "../db/schema";
import { env } from "../env";
import { TIMELINE, brainLevelAt, stageAt } from "../config/timeline";
import type { AnatomyPart, Capability, DevBar, PublicState } from "../../shared/types";
import { ageAt, speed } from "./clock";
import { bus, broadcast } from "./events";
import { capabilityMap, hasCap } from "./capabilities";
import { firedMap } from "./engine";
import { getSettings } from "./settings";

/** set at boot in live mode from /2/users/me */
let verifiedXHandle: string | null = null;
export function setVerifiedXHandle(h: string | null) {
  verifiedXHandle = h;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const frac = (caps: Capability[]) => caps.filter((c) => hasCap(c)).length / caps.length;

const ANATOMY: { key: string; label: string; caps: Capability[] }[] = [
  { key: "eyes", label: "EYES", caps: ["READ_TOKEN", "READ_HOLDERS", "READ_TRADES"] },
  { key: "ears", label: "EARS", caps: ["READ_X"] },
  { key: "memory", label: "MEMORY", caps: ["LONG_TERM_MEMORY", "RECOGNIZE_USERS"] },
  { key: "brain", label: "BRAIN", caps: ["ANALYZE_MARKET", "PROPOSE_ACTION"] },
  { key: "voice", label: "VOICE", caps: ["CHAT_WEB", "POST_X", "REPLY_X"] },
  { key: "hands", label: "HANDS", caps: ["EXECUTE_BUYBACK"] },
];

function unlockTime(caps: Capability[]): number | null {
  let latest: number | null = null;
  for (const s of TIMELINE) if (s.unlocks.some((c) => caps.includes(c))) latest = Math.max(latest ?? 0, s.t);
  return latest;
}

async function counts() {
  const [r] = await db.execute<{
    memories: number; people: number; words: number; mentions: number; proposals: number;
    buybacks: number; observations: number; decisions: number;
  }>(sql`select
    (select count(*) from memories)::int as memories,
    (select count(*) from people)::int as people,
    (select count(*) from slang)::int as words,
    (select count(*) from mentions)::int as mentions,
    (select count(*) from proposals)::int as proposals,
    (select count(*) from actions where type = 'BUYBACK' and status = 'CONFIRMED')::int as buybacks,
    (select count(*) from events where type = 'MARKET' and source = 'BABY')::int as observations,
    (select count(*) from events where type = 'DECISION' and source = 'BABY')::int as decisions
  `).then((res) => res.rows);
  return r;
}

export async function computeState(): Promise<PublicState> {
  const s = getSettings();
  const age = ageAt();
  const born = age !== null && age >= 0;
  const fired = firedMap();
  const c = await counts();

  const [snap] = await db.select().from(t.marketSnapshots).orderBy(desc(t.marketSnapshots.id)).limit(1);

  const [actions, proposals, memories, people, slang] = await Promise.all([
    db.select().from(t.actions).orderBy(desc(t.actions.id)).limit(50),
    db.select().from(t.proposals).orderBy(desc(t.proposals.id)).limit(30),
    db.select().from(t.memories).orderBy(desc(t.memories.id)).limit(50),
    db.select().from(t.people).orderBy(desc(t.people.interactions)).limit(50),
    db.select().from(t.slang).orderBy(desc(t.slang.learnedAtAgeS)).limit(50),
  ]);

  const tier = age === null || age < 120 ? 0.1 : age < 600 ? 0.35 : age < 1800 ? 0.65 : 1;
  const autonomySteps = ["autonomy_1", "autonomous_reply", "autonomous_post"].filter((id) => fired.has(id)).length / 3;

  const bars: DevBar[] = [
    { key: "language", label: "LANGUAGE", value: born ? clamp(0.5 * tier + 0.5 * Math.min(1, c.words / 15)) : 0, detail: `${c.words} words learned` },
    { key: "memory", label: "MEMORY", value: hasCap("LONG_TERM_MEMORY") ? clamp(0.3 + 0.7 * Math.min(1, c.memories / 60)) : 0, detail: `${c.memories} memories` },
    { key: "social", label: "SOCIAL CORTEX", value: clamp(0.5 * frac(["READ_X", "REPLY_X", "RECOGNIZE_USERS"]) + 0.5 * Math.min(1, c.people / 20)), detail: `${c.people} people known` },
    { key: "market", label: "MARKET UNDERSTANDING", value: clamp(0.7 * frac(["READ_TOKEN", "READ_HOLDERS", "READ_TRADES", "ANALYZE_MARKET"]) + 0.3 * Math.min(1, c.observations / 5)), detail: `${c.observations} market observations` },
    { key: "decisions", label: "DECISION MAKING", value: clamp((hasCap("PROPOSE_ACTION") ? 0.4 : 0) + 0.6 * Math.min(1, c.proposals / 4)), detail: `${c.proposals} proposals` },
    { key: "autonomy", label: "AUTONOMY", value: clamp(0.5 * autonomySteps + 0.5 * Math.min(1, c.decisions / 10)), detail: `${c.decisions} autonomous decisions` },
    { key: "treasury", label: "TREASURY CONTROL", value: clamp((hasCap("EXECUTE_BUYBACK") ? 0.3 : 0) + 0.7 * Math.min(1, c.buybacks / 3)), detail: `${c.buybacks} buybacks executed` },
  ];

  const anatomy: AnatomyPart[] = [
    ...ANATOMY.map((a) => {
      const on = a.caps.filter((x) => hasCap(x)).length;
      const locked = a.caps.filter((x) => !hasCap(x));
      return { key: a.key, label: a.label, capabilities: a.caps, active: on === a.caps.length, partial: on > 0 && on < a.caps.length, unlockAt: unlockTime(locked.length ? locked : a.caps) };
    }),
    { key: "guardian", label: "GUARDIAN", capabilities: [], active: born, partial: false, unlockAt: 0 },
    { key: "nervous", label: "NERVOUS SYSTEM", capabilities: [], active: fired.has("first_reply") && s.autonomyEnabled, partial: false, unlockAt: 12 * 60 },
  ];

  return {
    mode: env.MODE,
    simSpeed: speed,
    serverNow: new Date().toISOString(),
    launchAt: s.launchAt,
    ageS: age,
    stage: stageAt(age),
    brainLevel: brainLevelAt(age),
    timeline: TIMELINE.map((st) => ({ ...st, fired: fired.has(st.id), skipped: fired.get(st.id) === true })),
    capabilities: capabilityMap(),
    bars,
    anatomy,
    vitals: {
      priceUsd: snap?.price ?? null,
      mcapUsd: snap?.mcap ?? null,
      liquidityUsd: snap?.liq ?? null,
      holders: snap?.holders ?? null,
      treasurySol: snap?.treasurySol ?? null,
      mentions: c.mentions,
      memories: c.memories,
      wordsLearned: c.words,
      peopleKnown: c.people,
    },
    token: { mint: s.tokenMint, name: s.tokenName, symbol: s.tokenSymbol, xHandle: verifiedXHandle ?? env.X_BOT_HANDLE ?? null },
    flags: { xPaused: s.xPaused, chatPaused: s.chatPaused, treasuryFrozen: s.treasuryFrozen, autonomyEnabled: s.autonomyEnabled },
    actions: actions.map((a) => ({
      id: a.id, ts: a.ts.toISOString(), type: a.type, status: a.status, amountSol: a.amountSol, txSig: a.txSig,
      xUrl: a.xUrl, proofUrl: a.proofUrl, proposalId: a.proposalId, summary: a.summary,
    })),
    proposals: proposals.map((p) => ({
      id: p.id, ts: p.ts.toISOString(), type: p.type, amount: p.amount, reasons: p.reasons, confidence: p.confidence,
      status: p.status, guardianResult: p.guardianResult, guardianReason: p.guardianReason, maxAllowed: p.maxAllowed,
    })),
    memories: memories.map((m) => ({
      id: m.id, ts: m.ts.toISOString(), ageS: m.ageS, kind: m.kind, content: m.content, userHandle: m.userHandle, tags: m.tags, importance: m.importance,
    })),
    people: people.map((p) => ({
      handle: p.handle, platform: p.platform, firstSeenAgeS: p.firstSeenAgeS, interactions: p.interactions,
      lastSeen: p.lastSeen.toISOString(), relationshipSummary: p.relationshipSummary,
    })),
    slang: slang.map((w) => ({ term: w.term, definition: w.definition, learnedAtAgeS: w.learnedAtAgeS, sourceHandle: w.sourceHandle })),
  };
}

// ── cached public state, recomputed at most once per second and broadcast to all clients ──
let cached: PublicState | null = null;
let dirty = true;
let computing: Promise<PublicState> | null = null;

export async function getState(): Promise<PublicState> {
  if (cached && !dirty) return { ...cached, serverNow: new Date().toISOString(), ageS: ageAt() };
  if (!computing) {
    dirty = false;
    computing = computeState()
      .then((st) => (cached = st))
      .finally(() => (computing = null));
  }
  return computing;
}

/**
 * Broadcast deltas: once per second (only when something changed) send just the top-level keys whose content
 * changed. Clients get the full state once on connect. Keeps launch-day fan-out small.
 */
export function startStateBroadcaster() {
  bus.on("changed", () => (dirty = true));
  const lastSent = new Map<string, string>();
  setInterval(async () => {
    if (!dirty) return;
    try {
      const st = await getState();
      const patch: Record<string, unknown> = { serverNow: st.serverNow, ageS: st.ageS };
      for (const [k, v] of Object.entries(st)) {
        if (k === "serverNow" || k === "ageS") continue;
        const j = JSON.stringify(v);
        if (lastSent.get(k) !== j) {
          lastSent.set(k, j);
          patch[k] = v;
        }
      }
      if (Object.keys(patch).length > 2) broadcast("state:patch", patch);
    } catch (e) {
      console.error("[state] compute failed", e);
    }
  }, 1000);
}
