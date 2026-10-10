import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env, llmProvider } from "../env";

export const MEMORY_KINDS = ["episodic", "social", "semantic", "project", "decision", "outcome"] as const;
export const DECISIONS = ["IGNORE", "REMEMBER", "RESPOND", "POST", "ANALYZE", "PROPOSE"] as const;

/** Every Baby output has this shape (spec §4). Nullable rather than optional keeps structured outputs strict. */
export const BabyOutput = z.object({
  say: z.string().nullable().describe("What Baby says publicly (terminal / X / chat). null = say nothing."),
  post_to_x: z.boolean().describe("true only if `say` should be posted to X (when allowed for this task)."),
  reply_to_mention_id: z.string().nullable().describe("If replying on X, the id of the mention being replied to."),
  action: z
    .object({
      type: z.literal("BUYBACK"),
      amount_sol: z.number(),
      slippage_bps: z.number().int(),
      reasons: z.array(z.string()),
      confidence: z.number().describe("0 to 1"),
    })
    .nullable(),
  remember: z.array(
    z.object({
      kind: z.enum(MEMORY_KINDS),
      content: z.string(),
      user_handle: z.string().nullable(),
      tags: z.array(z.string()),
      importance: z.number().describe("0 to 1"),
    }),
  ),
  learn: z.array(z.object({ term: z.string(), definition: z.string(), source_handle: z.string().nullable() })),
  decision: z.enum(DECISIONS).nullable(),
  reasoning_summary: z.string().describe("One line, public, factual: what data led to this output. Not inner monologue."),
});
export type BabyOutput = z.infer<typeof BabyOutput>;

export const MentionRanking = z.object({
  ranked: z.array(
    z.object({
      id: z.string(),
      relevance: z.number(),
      sentiment: z.number().describe("-1 to 1"),
      spam: z.boolean(),
      score: z.number().describe("0 to 1 overall priority"),
      note: z.string(),
    }),
  ),
});
export type MentionRanking = z.infer<typeof MentionRanking>;

export type Tier = "main" | "cheap";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 }));

export class LLMRefusal extends Error {}

/** Call Claude and return schema-validated JSON. */
export async function callJSON<S extends z.ZodType>(opts: {
  tier: Tier;
  system: string;
  user: string;
  schema: S;
  maxTokens?: number;
  mock: () => z.infer<S>;
}): Promise<{ output: z.infer<S>; model: string }> {
  if (llmProvider === "mock") {
    await new Promise((r) => setTimeout(r, 40));
    return { output: opts.schema.parse(opts.mock()), model: "mock" };
  }
  const model = opts.tier === "main" ? env.LLM_MODEL_MAIN : env.LLM_MODEL_CHEAP;
  // Server-side refusal fallback is only offered for the main (Sonnet) tier.
  const fallback = opts.tier === "main" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  const res = await getClient().beta.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 2000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.tier === "main" ? "medium" : "low" },
    ...fallback,
  });
  if (res.stop_reason === "refusal") throw new LLMRefusal(`model declined (${res.stop_details?.category ?? "unknown"})`);
  if (res.stop_reason === "max_tokens") throw new Error("LLM output truncated (max_tokens)");
  if (!res.parsed_output) throw new Error("LLM returned no parseable output");
  // validate again — never trust the wire
  return { output: opts.schema.parse(res.parsed_output), model: res.model };
}
