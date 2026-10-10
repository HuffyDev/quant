import { useCallback, useMemo, useRef, useState } from "react";
import { QualityGovernor } from "./watchdog";

/** Quality levels and detection. No three.js here: the static image path imports this without the 3D chunk. */

export type Tier = "high" | "mid" | "low" | "min";
export const TIERS: Record<Tier, { points: number; lines: number; bloom: number; dpr: number }> = {
  high: { points: 42000, lines: 2200, bloom: 1, dpr: 1.75 },
  mid: { points: 24000, lines: 1400, bloom: 0.75, dpr: 1.4 },
  low: { points: 14000, lines: 800, bloom: 0, dpr: 1.25 },
  // last step before ever giving up: a sparse, unbloomed cloud at 1x
  min: { points: 7000, lines: 300, bloom: 0, dpr: 1 },
};
/** vertical field of view of the hero / stream camera (BrainImage matches its size to it) */
export const BRAIN_FOV = 40;
export const ORDER: Tier[] = ["high", "mid", "low", "min"];

let gl2: boolean | undefined;
function hasWebGL2() {
  if (gl2 === undefined) {
    try {
      gl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      gl2 = false;
    }
  }
  return gl2;
}
const isMobile = () => matchMedia("(max-width: 768px), (pointer: coarse)").matches;

/**
 * Starting quality. `?quality=high|mid|low|min|static` overrides detection (e.g. to pin it on the OBS machine).
 * null = static image from the start: reduced motion, no WebGL at all, or a weak mobile device.
 */
export function initialTier(): Tier | null {
  try {
    const forced = new URLSearchParams(location.search).get("quality");
    if (forced === "static") return null;
    if (forced && forced in TIERS) return forced as Tier;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const webgl2 = hasWebGL2();
    if (!webgl2 && !document.createElement("canvas").getContext("webgl")) return null;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const mem = nav.deviceMemory ?? 4;
    const mobile = isMobile();
    if (cores <= 2 || mem <= 1) return mobile || !webgl2 ? null : "min";
    if (mobile || cores <= 4 || mem <= 2) return "low";
    return cores >= 8 ? "high" : "mid";
  } catch {
    return null;
  }
}

/**
 * Adaptive quality (rules in ./watchdog): steps down one level after 4s of sustained <30fps, never during warm-up.
 * `onGiveUp` (static image) only on the lowest level, and on desktop with WebGL2 only when truly failing.
 */
export function useAdaptiveTier(startTier: Tier, maxTier: Tier, onGiveUp: () => void) {
  const pinned = useMemo(() => new URLSearchParams(location.search).has("quality"), []);
  const capped = ORDER[Math.max(ORDER.indexOf(startTier), ORDER.indexOf(maxTier))];
  const [tier, setTier] = useState<Tier>(capped);
  const governor = useMemo(() => new QualityGovernor(isMobile() || !hasWebGL2()), []);
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const onFps = useCallback(
    (fps: number, ms: number) => {
      if (pinned) return; // operator pinned the quality: never downgrade
      const cur = tierRef.current;
      const i = ORDER.indexOf(cur);
      const v = governor.window(fps, ms, i === ORDER.length - 1);
      if (v === "drop") {
        console.info(`[brain] sustained ${fps.toFixed(0)} fps — quality ${cur} → ${ORDER[i + 1]}`);
        tierRef.current = ORDER[i + 1];
        setTier(ORDER[i + 1]);
      } else if (v === "give-up") {
        console.info(`[brain] ${fps.toFixed(0)} fps on the lowest quality — static fallback`);
        onGiveUp();
      }
    },
    [pinned, governor, onGiveUp],
  );
  return { tier, capped, onFps };
}

