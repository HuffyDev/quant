import type { Capability, PublicEvent } from "@shared/types";

/** The six brain regions. Order is the shader's region index. */
export const REGIONS = [
  { key: "SOCIAL", caps: ["READ_X", "REPLY_X"] },
  { key: "MARKET", caps: ["ANALYZE_MARKET"] },
  { key: "MEMORY", caps: ["LONG_TERM_MEMORY"] },
  { key: "TREASURY", caps: ["EXECUTE_BUYBACK"] },
  { key: "DECISIONS", caps: ["PROPOSE_ACTION"] },
  { key: "LANGUAGE", caps: ["LEARN_SLANG"] },
] as const satisfies readonly { key: string; caps: readonly Capability[] }[];

export type RegionKey = (typeof REGIONS)[number]["key"];
export const REGION_INDEX = Object.fromEntries(REGIONS.map((r, i) => [r.key, i])) as Record<RegionKey, number>;

/** 1 = region lit (any of its capabilities unlocked). */
export function regionActivity(caps: Partial<Record<Capability, boolean>> | undefined): number[] {
  return REGIONS.map((r) => (r.caps.some((c) => caps?.[c]) ? 1 : 0));
}

/**
 * Split the brain into regions by position. Coordinates are normalised: centred, max half-extent 1,
 * x lateral, y up, z front (glTF convention: a model faces +Z). `inner` = a point inside the volume.
 */
export function regionOf(x: number, y: number, z: number, inner: boolean): number {
  if (inner && Math.hypot(x, y + 0.1, z) < 0.62) return REGION_INDEX.MEMORY;
  if (z < -0.5 || (y < -0.42 && z < -0.05)) return REGION_INDEX.TREASURY; // occipital, cerebellum, stem
  if (z > 0.38) return REGION_INDEX.DECISIONS; // frontal
  if (y < 0.05 && Math.abs(x) > 0.3) return x > 0 ? REGION_INDEX.LANGUAGE : REGION_INDEX.SOCIAL; // temporal
  if (y >= 0.05) return REGION_INDEX.MARKET; // parietal
  return REGION_INDEX.MEMORY;
}

/**
 * Regions for the front-facing image cloud (root.png is a coronal front view): crown → DECISIONS,
 * upper sides → MARKET, lower sides → SOCIAL (viewer's left) / LANGUAGE (right), bottom → TREASURY, centre → MEMORY.
 */
export function regionOfFront(x: number, y: number): number {
  if (y < -0.58) return REGION_INDEX.TREASURY;
  if (y > 0.5) return REGION_INDEX.DECISIONS;
  if (Math.abs(x) > 0.42 && y > -0.05) return REGION_INDEX.MARKET;
  if (Math.abs(x) > 0.3 && y <= -0.05) return x < 0 ? REGION_INDEX.SOCIAL : REGION_INDEX.LANGUAGE;
  return REGION_INDEX.MEMORY;
}

export type Pulse = { region: number } | { all: true; strength: number } | { alarm: true };

/** Which region a live event lights up (null = none). */
export function pulseFor(e: PublicEvent): Pulse | null {
  const d = (e.data ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "GUARDIAN":
      return d.approved === false ? { alarm: true } : { region: REGION_INDEX.DECISIONS };
    case "ACTION":
      return { region: REGION_INDEX.TREASURY };
    case "SOCIAL":
    case "CHAT":
      return { region: REGION_INDEX.SOCIAL };
    case "MEMORY":
      return { region: REGION_INDEX.MEMORY };
    case "LEARN":
      return { region: REGION_INDEX.LANGUAGE };
    case "MARKET":
      return { region: REGION_INDEX.MARKET };
    case "DECISION":
      return { region: REGION_INDEX.DECISIONS };
    case "BOOT":
      return { all: true, strength: 1 };
    case "ARC":
    case "PROGRESS":
      return { all: true, strength: 0.5 };
    default:
      return null;
  }
}
