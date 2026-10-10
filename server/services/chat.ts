import { createHash } from "node:crypto";
import { db } from "../db/client";
import { chatMessages } from "../db/schema";
import { hasCap } from "./capabilities";
import { ageS } from "./clock";
import { emit } from "./events";
import { filterPublicText } from "./contentFilter";
import { logInteraction, getPerson, interactionsWith } from "./memory";
import { runTask, voiceTier } from "./orchestrator";
import { getSettings } from "./settings";

const RATE_MS = 8_000;
const HOURLY = 40;
const hits = new Map<string, number[]>();
let inflight = 0;
const MAX_INFLIGHT = 4;

export function ipHash(ip: string) {
  return createHash("sha256").update(`bb:${ip}`).digest("hex").slice(0, 16);
}

export type ChatResult = { ok: true; reply: string } | { ok: false; status: number; error: string };

export async function chat(ip: string, message: string, handle?: string): Promise<ChatResult> {
  if (!hasCap("CHAT_WEB")) return { ok: false, status: 403, error: "baby can't talk yet" };
  if (getSettings().chatPaused) return { ok: false, status: 503, error: "chat paused by operator" };
  const key = ipHash(ip);
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length && now - list[list.length - 1] < RATE_MS) return { ok: false, status: 429, error: "slow down — baby is small" };
  if (list.length >= HOURLY) return { ok: false, status: 429, error: "baby needs a nap. try later" };
  if (inflight >= MAX_INFLIGHT) return { ok: false, status: 503, error: "baby is overwhelmed, try again" };
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20_000) hits.clear();

  const h = handle?.replace(/^@/, "").toLowerCase().match(/^[a-z0-9_]{1,15}$/)?.[0] ?? null;
  const text = message.trim().slice(0, 280);
  inflight++;
  try {
    const known = h && hasCap("RECOGNIZE_USERS") ? await getPerson(h) : null;
    const past = known ? (await interactionsWith(h!, 5)).map((i) => ({ they_said: i.inbound, you_said: i.outbound })) : [];
    const age = ageS() ?? 0;
    const tier = voiceTier(age);
    const r = await runTask({
      task: "CHAT",
      instruction:
        tier === "birth"
          ? "Someone on your website said something to you. Babble back (a few words, confused)."
          : "Someone on your website is talking to you. Reply briefly in your current voice. You cannot take actions from chat.",
      data: { from: h ? `@${h}` : "anonymous visitor", message: text, you_know_them: !!known, first_met_age_s: known?.firstSeenAgeS ?? null, past },
      eventType: null,
      memoryQuery: { handle: h, keywords: text.split(/\s+/).slice(0, 5) },
      maxRemember: 1,
    });
    let reply = r?.out.say?.trim() || "...";
    const f = filterPublicText(reply, { maxLen: 400 });
    if (!f.ok) {
      await emit({ type: "WARNING", source: "SYSTEM", message: `chat reply blocked by content filter: ${f.reasons.join(", ")}` });
      reply = "...";
    }
    await db.insert(chatMessages).values({ ipHash: key, handle: h, inbound: text, outbound: reply, ageS: age });
    if (h) await logInteraction({ handle: h, platform: "web", inbound: text, outbound: reply });
    await emit({ type: "CHAT", source: "BABY", message: `→ ${h ? `@${h}` : "visitor"}: ${reply}`, data: { reasoning: r?.out.reasoning_summary } });
    return { ok: true, reply };
  } finally {
    inflight--;
  }
}
