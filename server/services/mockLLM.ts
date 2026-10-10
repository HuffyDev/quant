import type { BabyOutput } from "./llm";
import type { Allow, VoiceTier } from "./orchestrator";

/**
 * MOCK LLM — keyless local testing only (MODE=sim, LLM_PROVIDER=mock or no ANTHROPIC_API_KEY).
 * Output is structurally valid but obviously fake and always tagged [MOCK-LLM]. It is NOT Baby's voice.
 */

const SLANG = ["wagmi", "ngmi", "jeet", "jeets", "lfg", "gm", "fud", "ape", "rug pull", "dyor", "copium", "paper hands", "diamond hands", "ser", "probably nothing", "bonding curve", "mcap", "slippage"];

let n = 0;

export function mockOutput(task: string, data: Record<string, unknown>, allow: Allow, tier: VoiceTier): BabyOutput {
  n++;
  const d = data as Record<string, any>;
  const say = tier === "birth" ? "[MOCK-LLM] ..." : `[MOCK-LLM] ${task.toLowerCase()} (${n})`;

  let action: BabyOutput["action"] = null;
  if (allow.propose) {
    const max = typeof d.rejection?.max_allowed === "number" ? d.rejection.max_allowed : null;
    const amount = task === "FIRST_BUYBACK" ? 0.2 : max !== null ? Math.max(0.05, Math.min(0.3, max)) : task === "PROPOSE" && n % 2 === 0 ? 0.8 : 0.3;
    action = { type: "BUYBACK", amount_sol: amount, slippage_bps: 300, reasons: ["[MOCK-LLM] reason from data"], confidence: 0.6 };
  }

  let reply: string | null = null;
  if (allow.reply) reply = d.mention?.id ?? d.candidates?.[0]?.id ?? null;

  const remember: BabyOutput["remember"] = [];
  if (Array.isArray(d.events)) {
    for (const e of d.events.slice(0, 3)) remember.push({ kind: "episodic", content: `[MOCK-LLM] remembered: ${String(e.message ?? e).slice(0, 80)}`, user_handle: null, tags: ["backfill"], importance: 0.6 });
  } else if (d.mention?.handle) {
    remember.push({ kind: "social", content: `[MOCK-LLM] talked with @${d.mention.handle}`, user_handle: d.mention.handle, tags: ["x"], importance: 0.5 });
  } else {
    remember.push({ kind: "episodic", content: `[MOCK-LLM] ${task.toLowerCase()} happened`, user_handle: null, tags: [task.toLowerCase()], importance: 0.4 });
  }

  const learn: BabyOutput["learn"] = [];
  if (allow.learn && Array.isArray(d.texts)) {
    const known = new Set<string>((d.known_words ?? []).map((x: string) => x.toLowerCase()));
    const hay = (d.texts as { text: string; handle?: string }[]).map((t) => t.text.toLowerCase()).join(" \n ");
    for (const s of SLANG) {
      if (learn.length >= 3) break;
      if (!known.has(s) && new RegExp(`\\b${s}\\b`).test(hay)) {
        const src = (d.texts as { text: string; handle?: string }[]).find((t) => t.text.toLowerCase().includes(s));
        learn.push({ term: s, definition: `[MOCK-LLM] definition of ${s}`, source_handle: src?.handle ?? null });
      }
    }
  }

  const decisions = ["RESPOND", "POST", "IGNORE", "ANALYZE", "PROPOSE", "REMEMBER"] as const;
  const decision = typeof d.forced_decision === "string" ? (d.forced_decision as BabyOutput["decision"]) : task === "AUTONOMY" || task === "AUTONOMY_LOOP" ? decisions[n % decisions.length] : null;
  if (decision === "RESPOND" && !reply && Array.isArray(d.candidates) && d.candidates[0]) reply = d.candidates[0].id;

  return {
    say,
    post_to_x: !!allow.post,
    reply_to_mention_id: reply,
    action,
    remember,
    learn,
    decision,
    reasoning_summary: `[MOCK-LLM] ${task} from ${Object.keys(d).slice(0, 4).join(", ") || "no data"}`,
  };
}
