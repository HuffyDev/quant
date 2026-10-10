import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { db } from "../db/client";
import { chatMessages } from "../db/schema";
import { hasCap } from "./capabilities";
import { ageS } from "./clock";
import { broadcast, emit } from "./events";
import { notifyRealChat } from "./probes";
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
  return createHash("sha256").update(`root:${ip}`).digest("hex").slice(0, 16);
}

/** What a visitor wrote, as it may be shown publicly (stream overlay): filtered like ROOT's own output. */
export function publicInbound(text: string): string {
  return filterPublicText(text, { maxLen: 280 }).ok ? text : "[message redacted]";
}

let inboundSeq = 0;

export type ChatResult = { ok: true; reply: string } | { ok: false; status: number; error: string };

/** Recent web chat for the stream overlay (re)connect. Visitor text is filtered; IPs never leave the server. */
export async function recentChat(limit = 30) {
  const rows = await db.select().from(chatMessages).orderBy(desc(chatMessages.id)).limit(limit);
  return rows.reverse().map((r) => ({ id: r.id, ts: r.ts.toISOString(), from: r.handle ? `@${r.handle}` : "visitor", inbound: publicInbound(r.inbound), outbound: r.outbound }));
}

export async function chat(ip: string, message: string, handle?: string): Promise<ChatResult> {
  if (!hasCap("CHAT_WEB")) return { ok: false, status: 403, error: "no shell yet. wait for launch." };
  if (getSettings().chatPaused) return { ok: false, status: 503, error: "chat paused by operator" };
  const key = ipHash(ip);
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length && now - list[list.length - 1] < RATE_MS) return { ok: false, status: 429, error: "rate limited. slow down." };
  if (list.length >= HOURLY) return { ok: false, status: 429, error: "hourly quota hit. try later." };
  if (inflight >= MAX_INFLIGHT) return { ok: false, status: 503, error: "busy. retry." };
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20_000) hits.clear();

  const h = handle?.replace(/^@/, "").toLowerCase().match(/^[a-z0-9_]{1,15}$/)?.[0] ?? null;
  const text = message.trim().slice(0, 280);
  inflight++;
  const inboundId = `${Date.now().toString(36)}-${++inboundSeq}`;
  notifyRealChat();
  broadcast("chat:in", { id: inboundId, from: h ? `@${h}` : "visitor", text: publicInbound(text), ts: new Date().toISOString() });
  try {
    const known = h && hasCap("RECOGNIZE_USERS") ? await getPerson(h) : null;
    const past = known ? (await interactionsWith(h!, 5)).map((i) => ({ they_said: i.inbound, you_said: i.outbound })) : [];
    const age = ageS() ?? 0;
    const tier = voiceTier(age);
    const r = await runTask({
      task: "CHAT",
      instruction:
        tier === "fragment"
          ? "Someone on your website said something to you. Answer with the few broken words you can get out."
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
    await emit({ type: "CHAT", source: "ROOT", message: `→ ${h ? `@${h}` : "visitor"}: ${reply}`, data: { reasoning: r?.out.reasoning_summary, inboundId, from: h ? `@${h}` : "visitor", reply } });
    return { ok: true, reply };
  } finally {
    inflight--;
  }
}
