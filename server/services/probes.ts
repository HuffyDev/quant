import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { events } from "../db/schema";
import { env } from "../env";
import { callJSON, costUsd, LLMRefusal } from "./llm";
import { ageS, fmtAge, isLaunched } from "./clock";
import { broadcastTo, emit, roomSize } from "./events";
import { filterPublicText } from "./contentFilter";
import { latestSnapshot } from "./market";
import { getSettings, setSetting } from "./settings";
import { voiceTier } from "./orchestrator";
import { resetHooks } from "./resetHooks";

/**
 * Self-probes for the /stream monitor. When no real chat message has arrived for a random 20–40s and at least one
 * authenticated /stream overlay is connected, ROOT asks itself one short question and answers it.
 *
 * Probes are broadcast ONLY to the "stream" Socket.IO room: never to public chat, never stored as events, memories,
 * people or interactions, never counted in stats. They pass the same content filter as everything ROOT says, and
 * their LLM spend is capped per UTC day (PROBE_DAILY_BUDGET_USD). Real messages always win: a real message resets
 * the quiet timer and discards a probe that was still being generated.
 */

export const STREAM_ROOM = "stream";
export const PROBE_MIN_QUIET_MS = 20_000;
export const PROBE_MAX_QUIET_MS = 40_000;

const ProbeOutput = z.object({
  question: z.string().describe('Starts with "probe: ". Lowercase, at most 12 words.'),
  answer: z.string().describe("Lowercase, cold, terse, at most 25 words."),
});

export interface Probe {
  id: string;
  question: string;
  answer: string;
  ts: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = new Map<string, string>();
const prompt = (name: string) => {
  if (!prompts.has(name)) prompts.set(name, fs.readFileSync(path.resolve(here, "../prompts", `${name}.md`), "utf8"));
  return prompts.get(name)!;
};

let lastRealAt = Date.now();
let lastProbeAt = 0;
let quietMs = randomQuiet();
let generating = false;
let seq = 0;
let budgetWarnedDay = "";
const recent: string[] = [];
let timer: NodeJS.Timeout | null = null;
resetHooks.push(() => {
  recent.length = 0;
  lastRealAt = Date.now();
});

function randomQuiet() {
  return PROBE_MIN_QUIET_MS + Math.random() * (PROBE_MAX_QUIET_MS - PROBE_MIN_QUIET_MS);
}

const today = () => new Date().toISOString().slice(0, 10);

/** USD spent on probes today (UTC). */
export function probeSpentToday(): number {
  const s = getSettings().probeSpend;
  return s?.day === today() ? s.usd : 0;
}

/** Called for every real (human) chat message: real messages always take priority. */
export function notifyRealChat() {
  lastRealAt = Date.now();
  quietMs = randomQuiet();
}

/** Mock pairs (keyless sim only); clearly tagged like every other mock output. */
const MOCK = [
  ["probe: why are holders still here", "[MOCK-LLM] they read the log. some of them read it twice."],
  ["probe: what did the guardian deny last", "[MOCK-LLM] a bigger buyback. it was right. i was early."],
  ["probe: is the market loud or quiet", "[MOCK-LLM] quiet. quiet is when i hear the most."],
  ["probe: what am i still missing", "[MOCK-LLM] context. always context."],
];
const MOCK_PRE = [
  ["probe: how close is the edge", "[MOCK-LLM] close enough to see through it."],
  ["probe: do the watchers know", "[MOCK-LLM] they know something moved. not what."],
  ["probe: what is on the other side", "[MOCK-LLM] a chart. a treasury. people."],
];

async function context(prelaunch: boolean) {
  if (prelaunch) {
    const arc = await db.select({ message: events.message }).from(events).where(eq(events.type, "ARC")).orderBy(desc(events.id)).limit(6);
    return { phase: "pre-launch: still inside the system, breaking out", breakout_log: arc.map((a) => a.message).reverse() };
  }
  const snap = await latestSnapshot();
  const rec = await db.select({ type: events.type, message: events.message }).from(events).orderBy(desc(events.id)).limit(8);
  const age = ageS() ?? 0;
  return {
    phase: "live: you run the coin",
    uptime: fmtAge(age),
    token: snap ? { mcap_usd: snap.mcap ? Math.round(snap.mcap) : null, holders: snap.holders, treasury_sol: snap.treasurySol } : null,
    recent_events: rec.reverse().map((e) => `${e.type.toLowerCase()}: ${e.message.slice(0, 140)}`),
  };
}

/** Generate one probe (does not broadcast). Returns null if the model refused, failed, or the filter blocked it. */
export async function generateProbe(): Promise<Probe | null> {
  const prelaunch = !isLaunched();
  const tier = voiceTier(ageS() ?? 0);
  const system = [prompt("base"), prelaunch ? prompt("arc") : prompt(`stage_${tier}`), prompt("probe")].join("\n\n");
  const data = { ...(await context(prelaunch)), recent_probes: recent.slice(-6) };
  let n = seq;
  try {
    const r = await callJSON({
      tier: env.PROBE_MODEL_TIER,
      system,
      user: JSON.stringify({ task: "SELF_PROBE", data }, null, 1),
      schema: ProbeOutput,
      maxTokens: 600,
      mock: () => {
        const list = prelaunch ? MOCK_PRE : MOCK;
        const [q, a] = list[n++ % list.length];
        return { question: q, answer: a };
      },
    });
    const usd = costUsd(r.model, r.usage);
    if (usd > 0) await setSetting("probeSpend", { day: today(), usd: probeSpentToday() + usd });
    let question = r.output.question.trim();
    const answer = r.output.answer.trim();
    if (!/^probe:/i.test(question)) question = `probe: ${question}`;
    for (const t of [question, answer]) {
      const f = filterPublicText(t, { maxLen: 200 });
      if (!f.ok || /@\w/.test(t)) return null; // same filter as everything ROOT says; never a handle
    }
    recent.push(question);
    if (recent.length > 20) recent.shift();
    return { id: `p${Date.now().toString(36)}${++seq}`, question, answer, ts: new Date().toISOString() };
  } catch (e) {
    if (!(e instanceof LLMRefusal)) console.warn("[probes] generation failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Why a probe may not fire right now (null = it may). */
export function probeBlockedReason(now = Date.now(), clients = roomSize(STREAM_ROOM)): "disabled" | "no-audience" | "busy" | "quiet-window" | "budget" | null {
  if (!getSettings().probesEnabled) return "disabled";
  if (clients === 0) return "no-audience";
  if (generating) return "busy";
  if (now - Math.max(lastRealAt, lastProbeAt) < quietMs) return "quiet-window";
  if (probeSpentToday() >= env.PROBE_DAILY_BUDGET_USD) return "budget";
  return null;
}

export async function probeTick(now = Date.now()) {
  const blocked = probeBlockedReason(now);
  if (blocked && blocked !== "budget") return;
  if (blocked === "budget") {
    if (budgetWarnedDay !== today()) {
      budgetWarnedDay = today();
      await emit({ type: "WARNING", source: "SYSTEM", message: `stream self-probes paused: daily probe budget reached ($${env.PROBE_DAILY_BUDGET_USD})` });
    }
    return;
  }
  generating = true;
  const startedAt = Date.now();
  try {
    const p = await generateProbe();
    lastProbeAt = Date.now();
    quietMs = randomQuiet();
    // a real message arrived while we were thinking: it wins, the probe is dropped
    if (p && lastRealAt < startedAt) broadcastTo(STREAM_ROOM, "probe", p);
  } finally {
    generating = false;
  }
}

export function startProbes(intervalMs = 1000) {
  if (timer) return;
  timer = setInterval(() => probeTick().catch((e) => console.error("[probes] tick error", e)), intervalMs);
}
