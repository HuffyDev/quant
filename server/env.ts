import "dotenv/config";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(5000),
  MODE: z.enum(["sim", "live"]).default("sim"),
  /** sim development speed. 10 = the first hour of development plays out in 6 real minutes. Clocks always show real time. */
  SIM_SPEED: z.coerce.number().positive().default(10),
  /** anthropic | mock. Mock is only for keyless local testing and is refused in live mode. */
  LLM_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  LLM_MODEL_MAIN: z.string().default("claude-sonnet-5-5"),
  LLM_MODEL_CHEAP: z.string().default("claude-haiku-5-5"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (add Replit Postgres)"),
  ADMIN_TOKEN: optional,
  /** reverse-proxy hops in front of the app (Replit = 1). Used to read the real client IP for chat rate limits. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  ANTHROPIC_API_KEY: optional,

  X_API_KEY: optional,
  X_API_SECRET: optional,
  X_ACCESS_TOKEN: optional,
  X_ACCESS_SECRET: optional,
  X_BEARER_TOKEN: optional,
  X_BOT_USER_ID: optional,
  X_BOT_HANDLE: optional,
  /** Hard daily spend cap for X API pay-per-use (USD) */
  X_DAILY_BUDGET_USD: z.coerce.number().default(5),
  /** Per-call cost estimates (USD). Check current X pricing and adjust. */
  X_COST_POST_USD: z.coerce.number().default(0.015),
  X_COST_READ_USD: z.coerce.number().default(0.005),
  /** Disable all real X writes in live mode (validate reads only) */
  X_WRITES_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),

  HELIUS_API_KEY: optional,
  HELIUS_RPC_URL: optional,
  BIRDEYE_API_KEY: optional,
  PUMPPORTAL_API_KEY: optional,
  JUPITER_API_KEY: optional,

  TOKEN_MINT: optional,
  TOKEN_NAME: optional,
  TOKEN_SYMBOL: optional,
  LAUNCH_TIMESTAMP: optional,

  TREASURY_PUBKEY: optional,
  // TREASURY_PRIVATE_KEY is deliberately NOT parsed here. Only server/services/executor.ts reads it.
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isSim = env.MODE === "sim";
export const isProd = env.NODE_ENV === "production";

/** Which LLM backend is actually in use. */
export const llmProvider: "anthropic" | "mock" = (() => {
  if (env.LLM_PROVIDER === "mock") {
    if (!isSim) {
      console.error("LLM_PROVIDER=mock is not allowed in MODE=live");
      process.exit(1);
    }
    return "mock";
  }
  if (!env.ANTHROPIC_API_KEY) {
    if (!isSim) {
      console.error("ANTHROPIC_API_KEY is required in MODE=live");
      process.exit(1);
    }
    console.warn("[env] ANTHROPIC_API_KEY missing — falling back to MOCK LLM (sim only). Outputs will be tagged [MOCK-LLM].");
    return "mock";
  }
  return "anthropic";
})();
