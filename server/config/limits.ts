/** Guardian limits (spec §6). Tune before launch; each can be overridden by env var of the same name. */
const num = (k: string, d: number) => {
  const v = process.env[k];
  return v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : d;
};

export const LIMITS = {
  MAX_BUYBACK_SOL_PER_TX: num("MAX_BUYBACK_SOL_PER_TX", 0.5),
  MAX_SPEND_SOL_PER_HOUR: num("MAX_SPEND_SOL_PER_HOUR", 2.0),
  MAX_SPEND_SOL_PER_DAY: num("MAX_SPEND_SOL_PER_DAY", 5.0),
  MIN_TREASURY_RESERVE_SOL: num("MIN_TREASURY_RESERVE_SOL", 3.0),
  MIN_SECONDS_BETWEEN_BUYBACKS: num("MIN_SECONDS_BETWEEN_BUYBACKS", 240),
  MAX_SLIPPAGE_BPS: num("MAX_SLIPPAGE_BPS", 500),
  /** Network fee + ATA rent headroom kept on top of the reserve */
  FEE_BUFFER_SOL: num("FEE_BUFFER_SOL", 0.01),
  ALLOWED_ACTIONS: ["BUYBACK"] as const,
} as const;

/** Fixed amount for the scripted-schedule FIRST ACTION at T+4 */
export const FIRST_BUYBACK_SOL = num("FIRST_BUYBACK_SOL", 0.2);

/** Autonomous loop caps (baby-seconds) */
export const AUTONOMY = {
  MIN_INTERVAL_S: 45,
  MAX_INTERVAL_S: 90,
  MIN_SECONDS_BETWEEN_AUTONOMOUS_POSTS: 180,
  /** shared cap for every X reply; the reply loop also runs on this interval */
  MIN_SECONDS_BETWEEN_REPLIES: num("MIN_SECONDS_BETWEEN_REPLIES", 60),
} as const;

/** Program IDs a buyback transaction may touch (checked by the executor before signing). */
export const ALLOWED_PROGRAMS: Record<string, string> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump.fun",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA": "PumpSwap",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6",
  "11111111111111111111111111111111": "System",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token-2022",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Account",
  "ComputeBudget111111111111111111111111111111": "ComputeBudget",
};

/** "Thought" posts: short tweets about growing up, at random intervals (baby-seconds). */
export const THOUGHTS = {
  ENABLED: process.env.THOUGHT_POSTS_ENABLED !== "false",
  MIN_S: num("THOUGHT_POST_MIN_S", 30),
  MAX_S: num("THOUGHT_POST_MAX_S", 120),
} as const;
