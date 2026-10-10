import { db } from "../db/client";
import { settings } from "../db/schema";
import { env } from "../env";
import { DEFAULT_ARC_SPACING_S } from "../config/arc";

export interface Settings {
  launchAt: string | null;
  tokenMint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  xPaused: boolean;
  chatPaused: boolean;
  treasuryFrozen: boolean;
  autonomyEnabled: boolean;
  simSeed: number;
  /** generated at T+42 from memories; fed into later prompts */
  personality: string | null;
  /** first major supporter identified at T+32 */
  supporterHandle: string | null;
  /** pre-launch arc: ISO time of beat 1 (null = not scheduled) */
  arcStartAt: string | null;
  /** pre-launch arc: real seconds between beats */
  arcSpacingS: number;
  arcPaused: boolean;
  /** /stream self-probes on/off (admin) */
  probesEnabled: boolean;
  /** probe LLM spend for the current UTC day */
  probeSpend: { day: string; usd: number };
}

const defaults = (): Settings => ({
  launchAt: env.LAUNCH_TIMESTAMP ? new Date(env.LAUNCH_TIMESTAMP).toISOString() : null,
  tokenMint: env.TOKEN_MINT ?? null,
  tokenName: env.TOKEN_NAME ?? null,
  tokenSymbol: env.TOKEN_SYMBOL ?? null,
  xPaused: false,
  chatPaused: false,
  treasuryFrozen: false,
  autonomyEnabled: true,
  simSeed: 1337,
  personality: null,
  supporterHandle: null,
  arcStartAt: null,
  arcSpacingS: DEFAULT_ARC_SPACING_S,
  arcPaused: false,
  probesEnabled: true,
  probeSpend: { day: "", usd: 0 },
});

let cache: Settings = defaults();

/** Load persisted settings. DB values win over env defaults (admin overrides survive restarts). */
export async function loadSettings() {
  const rows = await db.select().from(settings);
  const merged: Record<string, unknown> = { ...defaults() };
  for (const r of rows) merged[r.key] = r.value;
  cache = merged as unknown as Settings;
  // Env TOKEN_MINT/LAUNCH_TIMESTAMP fill gaps if never set via admin
  if (!cache.launchAt && env.LAUNCH_TIMESTAMP) cache.launchAt = new Date(env.LAUNCH_TIMESTAMP).toISOString();
  if (!cache.tokenMint && env.TOKEN_MINT) cache.tokenMint = env.TOKEN_MINT;
  return cache;
}

export function getSettings(): Readonly<Settings> {
  return cache;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  cache = { ...cache, [key]: value };
  await db
    .insert(settings)
    .values({ key, value: value as unknown })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as unknown, updatedAt: new Date() } });
}
