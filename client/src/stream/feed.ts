/**
 * /stream monitor feed: what is on screen at a given moment. Pure (no DOM), so it is unit-tested.
 *
 * - "in" lines (real visitors) appear instantly.
 * - "out" (ROOT replies), "arc" (breakout posts) and "probe-q"/"probe-a" (self-probes) type out one after another.
 * - Real messages always take priority: a probe line with `cutAt` stops typing at that moment (shown cut with "…"),
 *   and probe lines that had not started by then are dropped.
 */

export type FeedKind = "in" | "out" | "arc" | "probe-q" | "probe-a";

export interface FeedLine {
  key: string;
  kind: FeedKind;
  /** visitor label for "in" lines ("@handle" or "visitor"); never used for probes */
  from: string;
  text: string;
  /** client ms when it arrived live; null = history (shown whole, no typing) */
  liveAt: number | null;
  /** probes only: client ms when a real message interrupted the probe queue */
  cutAt?: number | null;
}

export interface ScheduledLine extends FeedLine {
  startAt: number | null;
  /** characters that may ever be shown (shorter than text when cut) */
  maxLen: number;
  cut: boolean;
}

const GAP_MS = 250;
const isProbe = (k: FeedKind) => k === "probe-q" || k === "probe-a";

export function scheduleFeed(lines: FeedLine[], cps: number): ScheduledLine[] {
  let free = 0;
  const out: ScheduledLine[] = [];
  for (const l of lines) {
    if (l.kind === "in" || l.liveAt === null) {
      out.push({ ...l, startAt: null, maxLen: l.text.length, cut: false });
      continue;
    }
    const startAt = Math.max(l.liveAt, free);
    const dur = (l.text.length / cps) * 1000;
    if (isProbe(l.kind) && l.cutAt != null && l.cutAt < startAt + dur) {
      if (l.cutAt <= startAt) continue; // never started: dropped
      const maxLen = Math.floor(((l.cutAt - startAt) / 1000) * cps);
      out.push({ ...l, startAt, maxLen, cut: true });
      free = l.cutAt;
      continue;
    }
    out.push({ ...l, startAt, maxLen: l.text.length, cut: false });
    free = startAt + dur + GAP_MS;
  }
  return out;
}

/** Characters visible at `now` (−1 = not started yet). */
export function visibleChars(l: ScheduledLine, now: number, cps: number): number {
  if (l.startAt === null) return l.maxLen;
  if (now < l.startAt) return -1;
  return Math.min(l.maxLen, Math.floor(((now - l.startAt) / 1000) * cps));
}

/** When the last line finishes typing (ms), for driving re-renders. */
export function typingEndsAt(lines: ScheduledLine[], cps: number): number {
  return lines.reduce((m, l) => (l.startAt === null ? m : Math.max(m, l.startAt + (l.maxLen / cps) * 1000)), 0);
}
