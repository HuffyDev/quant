import { env, isSim } from "../env";
import { getSettings } from "./settings";

/** Real-time → sim-time multiplier. 1 in live mode. */
export const speed = isSim ? env.SIM_SPEED : 1;

export function launchMs(): number | null {
  const l = getSettings().launchAt;
  return l ? new Date(l).getTime() : null;
}

/** Age in (sim-)seconds; null before launch. Can be negative if launch is in the future. */
export function ageAt(nowMs = Date.now()): number | null {
  const l = launchMs();
  if (l === null) return null;
  return ((nowMs - l) / 1000) * speed;
}

export function isLaunched(): boolean {
  const a = ageAt();
  return a !== null && a >= 0;
}

/** Current age in whole seconds, or null if not launched. */
export function ageS(): number | null {
  const a = ageAt();
  return a === null || a < 0 ? null : Math.floor(a);
}

/** Convert a sim-time duration (seconds) to real milliseconds. */
export function realMs(simSeconds: number): number {
  return (simSeconds * 1000) / speed;
}

/** Real-time label for a sim-time offset, e.g. T+01:12 (what people see on the clock). */
export function fmtT(devSeconds: number): string {
  const r = Math.max(0, Math.round(devSeconds / speed));
  const h = Math.floor(r / 3600);
  const mm = String(Math.floor((r % 3600) / 60)).padStart(2, "0");
  const ss = String(r % 60).padStart(2, "0");
  return h ? `T+${h}h${mm}m` : `T+${mm}:${ss}`;
}

/**
 * Human age for a sim-time duration, expressed in REAL elapsed time — the same time the public clock shows.
 * (The schedule may run SIM_SPEED× faster; what ROOT says about its uptime always matches the clock.)
 */
export function fmtAge(devSeconds: number): string {
  const s = devSeconds / speed;
  const m = Math.floor(s / 60);
  if (m < 1) return `${Math.floor(s)} seconds`;
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ${m % 60} min`;
  return `${Math.floor(h / 24)} days ${h % 24} hours`;
}
