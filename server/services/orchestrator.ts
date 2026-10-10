import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventType, TaskType } from "../../shared/types";
import { callJSON, BabyOutput, LLMRefusal, type Tier } from "./llm";
import { capabilityMap, hasCap } from "./capabilities";
import { ageS, fmtAge, speed } from "./clock";
import { emit } from "./events";
import { knownWords, learnWord, recall, remember } from "./memory";
import { stageAt } from "../config/timeline";
import { getSettings } from "./settings";
import { mockOutput } from "./mockLLM";

const here = path.dirname(fileURLToPath(import.meta.url));
const promptCache = new Map<string, string>();
function prompt(name: string): string {
  if (!promptCache.has(name)) promptCache.set(name, fs.readFileSync(path.resolve(here, "../prompts", `${name}.md`), "utf8"));
  return promptCache.get(name)!;
}

export type VoiceTier = "birth" | "early" | "cortex" | "analytical";
export function voiceTier(age: number): VoiceTier {
  if (age < 120) return "birth";
  if (age < 600) return "early";
  if (age < 1800) return "cortex";
  return "analytical";
}

export interface Allow {
  post?: boolean;
  reply?: boolean;
  propose?: boolean;
  learn?: boolean;
  remember?: boolean;
}

export interface RunInput {
  task: TaskType | "CHAT" | "AUTONOMY_LOOP" | "REPLY_LOOP" | "THOUGHT";
  /** What this step asks of Baby. Instructions only — never Baby's words. */
  instruction: string;
  /** Live data payload fed to the model. */
  data: Record<string, unknown>;
  allow?: Allow;
  tier?: Tier;
  /** memory retrieval hints */
  memoryQuery?: { handle?: string | null; keywords?: string[]; tags?: string[] };
  /** terminal event type for Baby's `say` (null = don't emit; caller handles) */
  eventType?: EventType | null;
  /** cap on stored memories for this call */
  maxRemember?: number;
}

export interface RunResult {
  out: BabyOutput;
  model: string;
}

/**
 * runTask: stage system prompt + capability list + relevant memories + live data → Claude → zod-validated JSON → events.
 * Returns null if the model failed or refused (a WARNING is logged; Baby stays silent).
 */
export async function runTask(input: RunInput): Promise<RunResult | null> {
  const age = ageS() ?? 0;
  const tier = voiceTier(age);
  const allow = input.allow ?? {};
  const caps = capabilityMap();
  const unlocked = Object.entries(caps).filter(([, v]) => v).map(([k]) => k);
  const words = tier === "birth" || tier === "early" ? [] : (await knownWords()).map((w) => w.term);
  const mems = await recall({ ...input.memoryQuery, limit: 12 });
  const personality = getSettings().personality;

  const system = [
    prompt("base"),
    prompt(`stage_${tier}`),
    personality ? `## Your personality (written by you earlier)\n${personality}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const permissions = [
    `post_to_x: ${allow.post ? "allowed for this task" : "NOT allowed — set false"}`,
    `reply_to_mention_id: ${allow.reply ? "allowed (use an id from the data)" : "NOT allowed — set null"}`,
    `action: ${allow.propose ? "allowed — BUYBACK only" : "NOT allowed — set null"}`,
    `learn: ${allow.learn && hasCap("LEARN_SLANG") ? "allowed (terms present in the data only)" : "NOT allowed — empty"}`,
    `remember: ${hasCap("LONG_TERM_MEMORY") ? "allowed" : "your long-term memory is not online yet — empty"}`,
  ];

  const user = JSON.stringify(
    {
      task: input.task,
      instruction: input.instruction,
      you: { age_seconds_real: Math.round(age / speed), age_human: fmtAge(age), stage: stageAt(age), unlocked_capabilities: unlocked },
      output_permissions: permissions,
      known_words: tier === "cortex" || tier === "analytical" ? words : undefined,
      memories: mems.length
        ? mems.map((m) => ({ kind: m.kind, content: m.content, user: m.userHandle, age_when_formed: m.ageS !== null ? fmtAge(m.ageS) : null }))
        : undefined,
      data: input.data,
    },
    null,
    1,
  );

  let result: { output: BabyOutput; model: string };
  try {
    result = await callJSON({
      tier: input.tier ?? "main",
      system,
      user,
      schema: BabyOutput,
      mock: () => mockOutput(input.task, input.data, allow, tier),
    });
  } catch (e) {
    const why = e instanceof LLMRefusal ? e.message : e instanceof Error ? e.message : String(e);
    await emit({ type: "WARNING", source: "SYSTEM", message: `LLM call for ${input.task} failed: ${why}`, data: { task: input.task } });
    return null;
  }

  const out = result.output;
  // enforce permissions regardless of what the model returned
  if (!allow.post) out.post_to_x = false;
  if (!allow.reply) out.reply_to_mention_id = null;
  if (!allow.propose) out.action = null;
  if (out.say !== null && !out.say.trim()) out.say = null;

  if (input.eventType !== null && out.say) {
    await emit({
      type: input.eventType ?? "SYSTEM",
      source: "BABY",
      message: out.say,
      data: { task: input.task, reasoning: out.reasoning_summary, model: result.model, decision: out.decision },
    });
  } else if (input.eventType !== null && out.reasoning_summary) {
    await emit({
      type: input.eventType ?? "SYSTEM",
      source: "BABY",
      message: `(${(out.decision ?? "silent").toLowerCase()}) ${out.reasoning_summary}`,
      data: { task: input.task, model: result.model, decision: out.decision },
    });
  }

  // memories (gated)
  if (hasCap("LONG_TERM_MEMORY") && (allow.remember ?? true)) {
    for (const m of out.remember.slice(0, input.maxRemember ?? 4)) await remember({ kind: m.kind, content: m.content, userHandle: m.user_handle, tags: m.tags, importance: m.importance });
  }

  // slang (gated + only words that actually appear in the provided data)
  if (allow.learn && hasCap("LEARN_SLANG")) {
    const haystack = JSON.stringify(input.data).toLowerCase();
    for (const w of out.learn.slice(0, 5)) {
      const term = w.term.toLowerCase().trim();
      if (term && haystack.includes(term)) await learnWord(term, w.definition, w.source_handle);
    }
  }

  return { out, model: result.model };
}
