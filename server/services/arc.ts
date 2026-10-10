import { eq, like } from "drizzle-orm";
import { db } from "../db/client";
import { actions, timelineFired } from "../db/schema";
import { ARC_BEATS, ARC_TOTAL, FINAL_BEAT_ID, MIN_ARC_SPACING_S_LIVE, type ArcBeat } from "../config/arc";
import type { PublicArc } from "../../shared/types";
import { isSim } from "../env";
import { launchMs } from "./clock";
import { emit, markDirty } from "./events";
import { runTask } from "./orchestrator";
import { postToX } from "./social";
import { getSettings } from "./settings";
import { queue } from "./queue";
import { resetHooks } from "./resetHooks";

/**
 * Pre-launch arc scheduler. Beat i fires at arcStartAt + i × arcSpacingS (real time), each exactly once
 * (claimed in timeline_fired as "arc:<id>", so restarts never re-post). After a restart, only the latest overdue
 * beat posts; older overdue ones are logged as skipped. Once launched, every unfired pre-launch beat is skipped:
 * T+0 posts the final beat instead.
 */

const PREFIX = "arc:";
/** beat id → skipped? */
const claimed = new Map<string, boolean>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

export async function loadArc() {
  claimed.clear();
  const rows = await db.select().from(timelineFired).where(like(timelineFired.stepId, `${PREFIX}%`));
  for (const r of rows) claimed.set(r.stepId.slice(PREFIX.length), r.skipped);
}
resetHooks.push(loadArc);

/** Atomically claim a beat. False if it already fired (here or in a previous process). */
export async function claimBeat(id: string, skipped: boolean): Promise<boolean> {
  const rows = await db
    .insert(timelineFired)
    .values({ stepId: PREFIX + id, ageS: 0, skipped, status: skipped ? "skipped" : "running" })
    .onConflictDoNothing()
    .returning();
  claimed.set(id, rows.length ? skipped : (claimed.get(id) ?? skipped));
  return rows.length > 0;
}

async function setStatus(id: string, status: string, error?: string) {
  await db.update(timelineFired).set({ status, error: error ?? null }).where(eq(timelineFired.stepId, PREFIX + id));
}

export function beatDueMs(index: number): number | null {
  const s = getSettings();
  if (!s.arcStartAt) return null;
  return new Date(s.arcStartAt).getTime() + index * s.arcSpacingS * 1000;
}

function launched(nowMs: number): boolean {
  const l = launchMs();
  return l !== null && nowMs >= l;
}

/** Validate the operator's schedule. */
export function validateArcSchedule(spacingS: number): string | null {
  if (!Number.isFinite(spacingS) || spacingS <= 0) return "spacing must be positive";
  if (!isSim && spacingS < MIN_ARC_SPACING_S_LIVE) return `spacing must be ≥ ${MIN_ARC_SPACING_S_LIVE}s in live mode`;
  return null;
}

export function containsRequired(text: string, required: string): boolean {
  return text.toLowerCase().includes(required.toLowerCase());
}

/** Generate the post for one beat. Retries when the required text is missing; returns null if it never complies. */
async function writeBeat(beat: ArcBeat, index: number): Promise<string | null> {
  const previous = await db.select({ text: actions.summary }).from(actions).where(eq(actions.type, "X_POST"));
  let feedback: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await runTask({
      task: "ARC_BEAT",
      voice: "arc",
      instruction: `Pre-launch beat ${index + 1} of ${ARC_TOTAL}. Directive: ${beat.directive}${beat.glitch ? " Use glitched / corrupted characters." : ""}`,
      data: {
        beat: index + 1,
        of: ARC_TOTAL,
        required_text: beat.requiredText ?? null,
        glitch: !!beat.glitch,
        previous_beats: previous.map((p) => p.text).filter(Boolean),
        ...(feedback ? { rejected_last_attempt: feedback } : {}),
      },
      allow: { post: true, remember: false },
      eventType: null,
    });
    const text = r?.out.say?.trim();
    if (!text) {
      feedback = "empty output";
      continue;
    }
    if (beat.requiredText && !containsRequired(text, beat.requiredText)) {
      feedback = `"${text}" did not contain the required text "${beat.requiredText}" exactly`;
      await emit({ type: "WARNING", source: "SYSTEM", message: `arc beat ${index + 1}: output missing "${beat.requiredText}" — regenerating`, data: { beat: beat.id, text } });
      continue;
    }
    return text;
  }
  return null;
}

async function fireBeat(beat: ArcBeat, index: number) {
  if (!(await claimBeat(beat.id, false))) return;
  await emit({ type: "ARC", source: "SYSTEM", message: `pre-launch beat ${index + 1}/${ARC_TOTAL} due`, data: { beat: beat.id, index } });
  markDirty();
  queue.push(`arc:${beat.id}`, async () => {
    try {
      const text = await writeBeat(beat, index);
      if (!text) {
        await setStatus(beat.id, "failed", "no compliant output");
        await emit({ type: "WARNING", source: "SYSTEM", message: `arc beat ${index + 1} not posted: no compliant output after 3 attempts`, data: { beat: beat.id } });
        return;
      }
      const res = await postToX(text, { prelaunch: true, summary: text });
      await emit({ type: "ARC", source: "ROOT", message: text, data: { beat: beat.id, index, posted: res.ok, reason: res.reason ?? null }, proofUrl: res.url ?? null });
      if (res.ok) await setStatus(beat.id, "done");
      else {
        await setStatus(beat.id, "failed", res.reason);
        await emit({ type: "WARNING", source: "SYSTEM", message: `arc beat ${index + 1} not posted: ${res.reason}`, data: { beat: beat.id } });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setStatus(beat.id, "failed", msg);
      await emit({ type: "WARNING", source: "SYSTEM", message: `arc beat ${index + 1} failed: ${msg}`, data: { beat: beat.id } });
    }
    markDirty();
  });
}

async function skipBeat(beat: ArcBeat, index: number, why: string, source: "SYSTEM" | "HUMAN" = "SYSTEM") {
  if (!(await claimBeat(beat.id, true))) return false;
  await emit({ type: "ARC", source, message: `pre-launch beat ${index + 1}/${ARC_TOTAL} skipped: ${why}`, data: { beat: beat.id, index, skipped: true } });
  markDirty();
  return true;
}

export async function arcTick(nowMs = Date.now()) {
  if (ticking) return;
  ticking = true;
  try {
    const s = getSettings();
    if (launched(nowMs)) {
      // launch overrides the arc: unfired beats are skipped, T+0 posts the final beat
      for (const [i, b] of ARC_BEATS.entries()) if (!claimed.has(b.id) && s.arcStartAt) await skipBeat(b, i, "launched before it was due");
      return;
    }
    if (!s.arcStartAt || s.arcPaused) return;
    const due = ARC_BEATS.map((b, i) => ({ b, i, at: beatDueMs(i)! })).filter((x) => x.at <= nowMs && !claimed.has(x.b.id));
    if (!due.length) return;
    // catch-up after downtime: only the latest overdue beat posts
    for (const x of due.slice(0, -1)) await skipBeat(x.b, x.i, "overdue (server was down or paused)");
    const last = due[due.length - 1];
    await fireBeat(last.b, last.i);
  } finally {
    ticking = false;
  }
}

/** Operator: skip one beat now. */
export async function skipBeatById(id: string): Promise<{ ok: boolean; error?: string }> {
  const i = ARC_BEATS.findIndex((b) => b.id === id);
  if (i < 0) return { ok: false, error: "unknown beat" };
  if (claimed.has(id)) return { ok: false, error: "beat already fired" };
  return (await skipBeat(ARC_BEATS[i], i, "operator", "HUMAN")) ? { ok: true } : { ok: false, error: "beat already fired" };
}

export function startArc(intervalMs = 1000) {
  if (timer) return;
  timer = setInterval(() => arcTick().catch((e) => console.error("[arc] tick error", e)), intervalMs);
}

export function stopArc() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Full schedule for the operator console (includes directives — never public). */
export async function arcAdminView() {
  const rows = await db.select().from(timelineFired).where(like(timelineFired.stepId, `${PREFIX}%`));
  const byId = new Map(rows.map((r) => [r.stepId.slice(PREFIX.length), r]));
  const s = getSettings();
  return {
    startAt: s.arcStartAt,
    spacingS: s.arcSpacingS,
    paused: s.arcPaused,
    beats: [
      ...ARC_BEATS.map((b, i) => {
        const at = beatDueMs(i);
        const r = byId.get(b.id);
        return { id: b.id, index: i, directive: b.directive, requiredText: b.requiredText ?? null, dueAt: at ? new Date(at).toISOString() : null, status: r?.status ?? "pending", error: r?.error ?? null };
      }),
      { id: FINAL_BEAT_ID, index: ARC_BEATS.length, directive: "fixed: root access granted + contract address (fires at LAUNCH)", requiredText: null, dueAt: s.launchAt, status: byId.get(FINAL_BEAT_ID)?.status ?? "pending", error: byId.get(FINAL_BEAT_ID)?.error ?? null },
    ],
  };
}

/** Public view: no directives, no upcoming text — only timing and what already happened. */
export function arcPublicView(nowMs = Date.now()): PublicArc {
  const s = getSettings();
  const pending = launched(nowMs) || s.arcPaused ? [] : ARC_BEATS.map((b, i) => ({ b, at: beatDueMs(i) })).filter((x) => x.at !== null && !claimed.has(x.b.id));
  const nextAt = pending.length ? new Date(pending[0].at!).toISOString() : null;
  return {
    startAt: s.arcStartAt,
    spacingS: s.arcSpacingS,
    paused: s.arcPaused,
    total: ARC_TOTAL,
    nextAt,
    beats: [...ARC_BEATS.map((b) => b.id), FINAL_BEAT_ID].map((id, index) => ({ id, index, fired: claimed.has(id) && !claimed.get(id), skipped: claimed.get(id) === true })),
  };
}

/** Called from the T+0 task. */
export async function markFinalBeat(status: "done" | "failed", error?: string) {
  await claimBeat(FINAL_BEAT_ID, false);
  await setStatus(FINAL_BEAT_ID, status, error);
  markDirty();
}
