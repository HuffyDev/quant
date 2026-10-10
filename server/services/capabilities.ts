import { db } from "../db/client";
import { capabilities } from "../db/schema";
import { CAPABILITIES, type Capability } from "../../shared/types";
import { ageS } from "./clock";
import { markDirty } from "./events";

export class CapabilityLockedError extends Error {
  constructor(public capability: Capability) {
    super(`capability ${capability} is locked`);
    this.name = "CapabilityLockedError";
  }
}

const enabled = new Set<Capability>();

export async function loadCapabilities() {
  enabled.clear();
  const rows = await db.select().from(capabilities);
  for (const r of rows) if (r.enabled) enabled.add(r.name as Capability);
}

export function hasCap(c: Capability): boolean {
  return enabled.has(c);
}

/** Every Baby-facing service call goes through this. Throws when the flag is off. */
export function requireCap(c: Capability): void {
  if (!enabled.has(c)) throw new CapabilityLockedError(c);
}

export async function unlock(c: Capability) {
  if (enabled.has(c)) return;
  await db
    .insert(capabilities)
    .values({ name: c, enabled: true, unlockedAt: new Date(), unlockedAtAgeS: ageS() })
    .onConflictDoUpdate({ target: capabilities.name, set: { enabled: true, unlockedAt: new Date(), unlockedAtAgeS: ageS() } });
  enabled.add(c);
  markDirty();
}

export function capabilityMap(): Record<Capability, boolean> {
  return Object.fromEntries(CAPABILITIES.map((c) => [c, enabled.has(c)])) as Record<Capability, boolean>;
}
