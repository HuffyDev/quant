/**
 * Frame-rate watchdog for the 3D brain. Pure (no DOM, no three.js) so it is unit-tested.
 *
 * - Nothing is measured for WARMUP_MS after load, after a quality change, or after the canvas resumes (tab switch,
 *   scrolled back on screen): shader compiles, texture uploads and the first composites are always slow.
 * - Frames are counted in ~1s windows. Only SUSTAINED slowness counts: below SLOW_FPS continuously for SLOW_FOR_MS
 *   drops one quality level. Any window at or above SLOW_FPS clears it.
 * - Quality steps down level by level. Giving up (static image) is a last resort:
 *     · mobile / no WebGL2: still below SLOW_FPS for SLOW_FOR_MS on the lowest level
 *     · desktop with WebGL2: only when truly failing — below DEAD_FPS for DEAD_FOR_MS on the lowest level
 *       (a slideshow, not a slow brain), or a lost WebGL context (handled by the caller).
 */

export const WARMUP_MS = 3000;
export const WINDOW_MS = 1000;
export const SLOW_FPS = 30;
export const SLOW_FOR_MS = 4000;
export const DEAD_FPS = 6;
export const DEAD_FOR_MS = 10_000;

/** Counts frames into windows. Call `frame(now)` once per rendered frame; it returns the fps of a closed window. */
export class FpsSampler {
  private warmUntil = -1;
  private t0 = 0;
  private n = 0;

  /** Restart the warm-up (load, quality change, resume). */
  reset(now: number) {
    this.warmUntil = now + WARMUP_MS;
    this.t0 = 0;
    this.n = 0;
  }

  frame(now: number): { fps: number; ms: number } | null {
    if (this.warmUntil < 0) this.reset(now);
    if (now < this.warmUntil) return null;
    if (!this.t0) {
      this.t0 = now;
      return null;
    }
    this.n++;
    const ms = now - this.t0;
    if (ms < WINDOW_MS) return null;
    const fps = (this.n * 1000) / ms;
    this.t0 = now;
    this.n = 0;
    return { fps, ms };
  }
}

export type Verdict = "ok" | "drop" | "give-up";

/** Turns measured windows into quality decisions. */
export class QualityGovernor {
  private slowMs = 0;
  private deadMs = 0;

  /** @param canGiveUp false on desktop with WebGL2: only a truly failing renderer may fall back to static */
  constructor(private readonly canGiveUp: boolean) {}

  /** Clear the history (after a quality change the new level gets a fresh, warm-up-protected chance). */
  reset() {
    this.slowMs = 0;
    this.deadMs = 0;
  }

  window(fps: number, ms: number, atLowest: boolean): Verdict {
    this.slowMs = fps < SLOW_FPS ? this.slowMs + ms : 0;
    this.deadMs = fps < DEAD_FPS ? this.deadMs + ms : 0;
    if (!atLowest) {
      if (this.slowMs < SLOW_FOR_MS) return "ok";
      this.reset();
      return "drop";
    }
    if (this.canGiveUp ? this.slowMs >= SLOW_FOR_MS : this.deadMs >= DEAD_FOR_MS) {
      this.reset();
      return "give-up";
    }
    return "ok";
  }
}
