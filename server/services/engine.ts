import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { timelineFired } from "../db/schema";
import { TIMELINE, stepById } from "../config/timeline";
import type { TimelineStep } from "../../shared/types";
import { ageAt, ageS, fmtT } from "./clock";
import { emit, markDirty } from "./events";
import { capabilityMap, unlock } from "./capabilities";
import { runStepTask } from "./tasks";
import { queue } from "./queue";

/** step id → skipped? */
const fired = new Map<string, boolean>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

export async function loadFired() {
  fired.clear();
  const rows = await db.select().from(timelineFired);
  for (const r of rows) fired.set(r.stepId, r.skipped);
}

export function firedMap(): ReadonlyMap<string, boolean> {
  return fired;
}

/** Atomically claim a step in the DB. Returns false if it was already fired (e.g. by a previous process). */
async function claim(step: TimelineStep, skipped: boolean): Promise<boolean> {
  const rows = await db
    .insert(timelineFired)
    .values({ stepId: step.id, ageS: ageS() ?? 0, skipped, status: skipped ? "skipped" : "running" })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    fired.set(step.id, skipped);
    return false;
  }
  fired.set(step.id, skipped);
  return true;
}

async function fire(step: TimelineStep) {
  if (!(await claim(step, false))) return;
  for (const c of step.unlocks) await unlock(c);
  await emit({
    type: step.id === "birth" ? "BIRTH" : "DEVELOPMENT",
    source: "SYSTEM",
    message:
      `${fmtT(step.t)} ${step.label}` + (step.unlocks.length ? ` — unlocked ${step.unlocks.join(", ")}` : ""),
    data: { stepId: step.id, unlocks: step.unlocks, brainLevel: step.brainLevel, stage: step.stage },
  });
  queue.push(`step:${step.id}`, async () => {
    try {
      await runStepTask(step);
      await db.update(timelineFired).set({ status: "done" }).where(eq(timelineFired.stepId, step.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(timelineFired).set({ status: "failed", error: msg }).where(eq(timelineFired.stepId, step.id));
      await emit({ type: "WARNING", source: "SYSTEM", message: `step ${step.label} failed: ${msg}`, data: { stepId: step.id } });
    }
    markDirty();
  });
}

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const age = ageAt();
    if (age === null || age < 0) return;
    for (const step of TIMELINE) {
      if (step.t > age) break;
      if (!step.wired || fired.has(step.id)) continue;
      await fire(step);
    }
  } finally {
    ticking = false;
  }
}

export function startEngine(intervalMs = 250) {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((e) => console.error("[engine] tick error", e));
  }, intervalMs);
}

export function stopEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Admin: mark a step as fired without running its task. Capabilities still unlock (the schedule moves on). */
export async function skipStep(stepId: string): Promise<{ ok: boolean; error?: string }> {
  const step = stepById(stepId);
  if (!step) return { ok: false, error: "unknown step" };
  if (!step.wired) return { ok: false, error: "step is not wired" };
  if (fired.has(stepId)) return { ok: false, error: "step already fired" };
  if (!(await claim(step, true))) return { ok: false, error: "step already fired" };
  for (const c of step.unlocks) await unlock(c);
  await emit({
    type: "DEVELOPMENT",
    source: "HUMAN",
    message: `${fmtT(step.t)} ${step.label} skipped by operator` + (step.unlocks.length ? ` — unlocked ${step.unlocks.join(", ")}` : ""),
    data: { stepId, skipped: true },
  });
  markDirty();
  return { ok: true };
}

export async function adminStatus() {
  const rows = await db.select().from(timelineFired);
  return { ageS: ageS(), fired: rows, queue: queue.pending(), capabilities: capabilityMap() };
}
