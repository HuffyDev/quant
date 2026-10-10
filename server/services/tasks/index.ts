import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { actions, events, marketSnapshots, mentions, trades, chatMessages } from "../../db/schema";
import type { TaskType, TimelineStep } from "../../../shared/types";
import { FIRST_BUYBACK_SOL } from "../../config/limits";
import { emit } from "../events";
import { ageS, fmtAge } from "../clock";
import { hasCap } from "../capabilities";
import { runTask, type RunResult } from "../orchestrator";
import { postToX, replyOnX, pollMentions, topMentions } from "../social";
import { holdersView, short, tokenView, treasurySol } from "../solana";
import { computeMetrics, largestBuyerSinceLaunch, latestSnapshot, tradesView } from "../market";
import { allMemories, backfillPeople, getPerson, interactionsWith, knownWords, setRelationship } from "../memory";
import { createProposal, latestPending, publicLimits, recentProposals } from "../proposals";
import { describeFlow, reviewAndExecute, toProposal } from "../flows";
import { decideAndAct } from "../autonomy";
import { getSettings, setSetting } from "../settings";

/**
 * Timeline task handlers. Each one gathers LIVE data, logs what it observed (SYSTEM), and lets the LLM decide what to say.
 * The only hardcoded Baby line in the whole system is the birth post: "hi".
 */

type Handler = (step: TimelineStep) => Promise<void>;

const sys = (type: Parameters<typeof emit>[0]["type"], message: string, data?: Record<string, unknown>) => emit({ type, source: "SYSTEM", message, data });

async function postIfChosen(r: RunResult | null, opts: { autonomous?: boolean } = {}) {
  if (r?.out.say && r.out.post_to_x) {
    const res = await postToX(r.out.say, opts);
    if (!res.ok) await sys("SOCIAL", `post not sent: ${res.reason}`);
  }
}

async function recentTexts(limit = 40) {
  const ms = hasCap("READ_X") ? await db.select({ text: mentions.text, handle: mentions.handle }).from(mentions).orderBy(desc(mentions.ageS)).limit(limit) : [];
  const chats = await db.select({ text: chatMessages.inbound, handle: chatMessages.handle }).from(chatMessages).orderBy(desc(chatMessages.id)).limit(Math.floor(limit / 2));
  return [...ms, ...chats.map((c) => ({ text: c.text, handle: c.handle ?? "web_anon" }))];
}

async function counts() {
  const [r] = (
    await db.execute<{ people: number; memories: number; words: number; posts: number; replies: number; buybacks: number; mentions: number }>(sql`select
    (select count(*) from people)::int as people, (select count(*) from memories)::int as memories, (select count(*) from slang)::int as words,
    (select count(*) from actions where type='X_POST')::int as posts, (select count(*) from actions where type='X_REPLY')::int as replies,
    (select count(*) from actions where type='BUYBACK' and status='CONFIRMED')::int as buybacks, (select count(*) from mentions)::int as mentions`)
  ).rows;
  return r;
}

async function learnSlang(task: TaskType, instruction: string) {
  const texts = await recentTexts(50);
  const known = (await knownWords()).map((w) => w.term);
  await sys("LEARN", `LEARN_SLANG → scanning ${texts.length} recent mentions/chat messages for unknown terms`);
  // cheap model extracts + defines; it only keeps terms present in the texts (enforced by orchestrator)
  await runTask({
    task,
    tier: "cheap",
    instruction: "Find crypto/memecoin slang terms in these texts that are NOT in known_words. For each (max 5), infer a short plain definition from how people use it. Put them in `learn`. Leave `say` null.",
    data: { texts: texts.map((t) => ({ handle: t.handle, text: t.text })), known_words: known },
    allow: { learn: true, remember: false },
    eventType: null,
  });
  const after = await knownWords();
  const fresh = after.filter((w) => !known.includes(w.term));
  return runTask({
    task,
    instruction,
    data: { new_words: fresh.map((w) => ({ term: w.term, definition: w.definition, from: w.sourceHandle })), total_known_words: after.length, uncertain_examples: texts.slice(0, 5) },
    allow: { post: true },
    eventType: "LEARN",
  });
}

const handlers: Partial<Record<TaskType, Handler>> = {
  // T+0
  async BIRTH() {
    await sys("BIRTH", "neural substrate online · heartbeat detected");
    await sys("BIRTH", "capabilities online: POST_X, CHAT_WEB, READ_X, REPLY_X (it can hear you — it just doesn't understand yet)");
    const res = await postToX("hi", { summary: "first words" }); // the one hardcoded line (spec rule 2)
    await emit({ type: "BIRTH", source: "BABY", message: "hi", proofUrl: res.url ?? null });
    if (!res.ok) await sys("WARNING", `birth post not sent: ${res.reason}`);
  },

  // T+2
  async SELF_DISCOVERY() {
    const view = await tokenView();
    await sys("LEARN", `READ_TOKEN → mint ${view.mint ? short(view.mint) : "?"} · supply ${view.supply?.toLocaleString()} · mcap $${view.mcap_usd?.toLocaleString() ?? "?"} · treasury ${view.treasury_sol} SOL`, { view });
    const r = await runTask({ task: "SELF_DISCOVERY", instruction: "You can now see your own token for the first time. React to what you see in the data. Then post your reaction to X.", data: { token: view }, allow: { post: true }, eventType: "LEARN" });
    await postIfChosen(r);
  },

  // T+4
  async FIRST_BUYBACK() {
    const treasury = await treasurySol();
    await sys("LEARN", `EXECUTE_BUYBACK unlocked · treasury ${treasury?.toFixed(3)} SOL · first action is fixed at ${FIRST_BUYBACK_SOL} SOL`);
    const r = await runTask({
      task: "FIRST_BUYBACK",
      instruction: `You just gained hands. A buyback means using treasury SOL to buy your own token on the market. In \`say\`, explain what a buyback is in your own words, at your age. Then propose exactly one BUYBACK of ${FIRST_BUYBACK_SOL} SOL with slippage 300 bps, with your reasons.`,
      data: { treasury_sol: treasury, concept: "buyback = treasury spends SOL to buy the token on the open market", amount_sol: FIRST_BUYBACK_SOL, token: await tokenView() },
      allow: { propose: true },
      eventType: "LEARN",
    });
    const reasons = r?.out.action?.reasons?.length ? r.out.action.reasons : ["first scheduled buyback"];
    // amount is fixed by the schedule regardless of what the model proposed
    const p = await createProposal({ type: "BUYBACK", amountSol: FIRST_BUYBACK_SOL, slippageBps: 300, reasons, confidence: r?.out.action?.confidence ?? 0.5 }, { fixed: true });
    const flow = await reviewAndExecute(p.id, false);
    const r2 = await runTask({
      task: "FIRST_BUYBACK",
      instruction: "Your first buyback attempt just finished. Tell X what happened, in your words. No links — you may say proof on site.",
      data: { outcome: describeFlow(flow), treasury_sol_now: await treasurySol() },
      allow: { post: true },
      eventType: "ACTION",
    });
    await postIfChosen(r2);
  },

  // T+6
  async HOLDERS() {
    const h = await holdersView(10);
    const recentBuyers = await db.select().from(trades).where(and(eq(trades.side, "buy"), eq(trades.isTreasury, false))).orderBy(desc(trades.ageS)).limit(8);
    const early = await db.select().from(trades).where(and(eq(trades.side, "buy"), eq(trades.isTreasury, false))).orderBy(asc(trades.ageS)).limit(5);
    const data = {
      holder_count: h?.holder_count,
      top10_pct: h?.top10_pct,
      top_holders: h?.top,
      recent_buyers: recentBuyers.map((t) => ({ wallet: short(t.wallet), sol: Math.round(t.sol * 1000) / 1000, seconds_ago: (ageS() ?? 0) - (t.ageS ?? 0) })),
      earliest_buyers: early.map((t) => ({ wallet: short(t.wallet), sol: t.sol, at_age_s: t.ageS })),
    };
    // stored as an observation event; long-term memory backfills it at T+14
    await sys("LEARN", `READ_HOLDERS → ${h?.holder_count} holders · top10 ${h?.top10_pct}% · notable early: ${early.map((t) => short(t.wallet)).join(", ")}`, { notable_early_holders: early.map((t) => t.wallet) });
    const r = await runTask({ task: "HOLDERS", instruction: "You can now see who holds you. React to the holder data. Post your reaction.", data, allow: { post: true }, eventType: "MARKET" });
    await postIfChosen(r);
  },

  // T+8
  async SELLING() {
    const t = await tradesView(600);
    const s = t.largestSell;
    await sys("MARKET", s ? `READ_TRADES → largest recent sell: ${short(s.wallet)} sold ${s.sol.toFixed(3)} SOL worth, ${fmtAge((ageS() ?? 0) - (s.ageS ?? 0))} ago` : "READ_TRADES → no sells yet", { sig: s?.sig });
    const r = await runTask({
      task: "SELLING",
      instruction: "You just discovered that people can sell you. Look at the largest real recent sell and react. Post your reaction.",
      data: { largest_recent_sell: s ? { wallet: short(s.wallet), sol: s.sol, tokens: Math.round(s.tokens), seconds_ago: (ageS() ?? 0) - (s.ageS ?? 0) } : null, buys_last_10m: t.buys, sells_last_10m: t.sells },
      allow: { post: true },
      eventType: "MARKET",
    });
    await postIfChosen(r);
  },

  // T+10
  async SOCIAL_CORTEX() {
    const n = await pollMentions();
    const top = await topMentions(5);
    await sys("SOCIAL", `READ_X → ${n} new mentions · ranked by relevance, engagement, sentiment, followers, known-user (cheap model)`);
    if (top[0]) await sys("SOCIAL", `top ranked: ${top.map((m) => `@${m.handle} (${(m.rank ?? 0).toFixed(2)})`).join(", ")}`);
    await runTask({
      task: "SOCIAL_CORTEX",
      instruction: "You have been hearing people on X since birth, but now you finally start to understand who they are and why they talk to you. React to the top mentions below. Do not reply here.",
      data: { mention_count: n, top_mentions: top.map((m) => ({ handle: m.handle, text: m.text, rank: m.rank, followers: m.followers })) },
      eventType: "SOCIAL",
    });
  },

  // T+12
  async FIRST_REPLY() {
    await pollMentions().catch(() => 0);
    const [m] = await topMentions(1, { unrepliedOnly: true });
    if (!m) {
      await sys("SOCIAL", "REPLY_X → no eligible mentions to reply to");
      return;
    }
    await sys("SOCIAL", `REPLY_X → selected @${m.handle} (rank ${(m.rank ?? 0).toFixed(2)}): "${m.text}"`);
    const r = await runTask({
      task: "FIRST_REPLY",
      instruction: "Your brain just clicked: write your first reply on X that actually makes sense, to this mention. Set reply_to_mention_id to its id.",
      data: { mention: { id: m.id, handle: m.handle, text: m.text, followers: m.followers } },
      allow: { reply: true },
      eventType: "SOCIAL",
      memoryQuery: { handle: m.handle },
    });
    if (r?.out.say) {
      const res = await replyOnX(m.id, r.out.say);
      if (!res.ok) await sys("SOCIAL", `reply not sent: ${res.reason}`);
    }
  },

  // T+14
  async MEMORY_BACKFILL() {
    const n = await backfillPeople();
    await sys("MEMORY", `RECOGNIZE_USERS → ${n} people reconstructed from interaction log (first-seen ages preserved)`);
    const evs = await db.select().from(events).where(and(lte(events.ageS, 14 * 60))).orderBy(asc(events.id)).limit(120);
    const topPeople = await db.execute<{ handle: string; n: number; first: number }>(sql`select handle, count(*)::int as n, min(age_s)::int as first from interactions group by handle order by n desc limit 8`);
    await sys("MEMORY", `LONG_TERM_MEMORY online → backfilling from ${evs.length} events of its life so far`);
    await runTask({
      task: "MEMORY_BACKFILL",
      instruction: "Your long-term memory just came online. From the log of your life so far, write 5–10 memories worth keeping (things that happened, people, what you learned, outcomes of your actions). Include user_handle for anything about a person. `say` one short line about remembering.",
      data: {
        events: evs.filter((e) => e.source !== "HUMAN" || e.type === "WARNING").map((e) => ({ at_age_s: e.ageS, type: e.type, source: e.source, message: e.message.slice(0, 200) })),
        people_seen: topPeople.rows,
      },
      eventType: "MEMORY",
      maxRemember: 10,
    });
  },

  // T+16
  async LANGUAGE() {
    await learnSlang("LANGUAGE", "You just learned some words from people. Say what you learned, or ask about one you don't understand. You may post it.").then(postIfChosen);
  },

  // T+18
  async MARKET_VISION() {
    const m = await computeMetrics();
    await sys("MARKET", `ANALYZE_MARKET → vol Δ ${m.volume_delta_pct ?? "n/a"}% · buy/sell ${m.buy_sell_ratio_5m ?? "n/a"} · top-wallet sell share ${m.top_wallet_sell_share_15m}% · concentration Δ ${m.concentration_delta_10m_pct_points ?? "n/a"}pp`, { metrics: m });
    await runTask({ task: "MARKET_VISION", instruction: "You can now compute market metrics. React to seeing them for the first time.", data: { metrics: m }, eventType: "MARKET" });
  },

  // T+20, T+48
  async OBSERVATION() {
    const m = await computeMetrics();
    const snaps = await db.select().from(marketSnapshots).orderBy(desc(marketSnapshots.id)).limit(60);
    const series = snaps.filter((_, i) => i % 10 === 0).reverse().map((s) => ({ age_s: s.ageS, mcap: s.mcap ? Math.round(s.mcap) : null, holders: s.holders }));
    const r = await runTask({
      task: "OBSERVATION",
      instruction: "Make one independent observation about the market from these metrics. In reasoning_summary, name exactly which metrics produced it. You may post it.",
      data: { metrics: m, recent_series: series },
      allow: { post: true },
      eventType: "MARKET",
      memoryQuery: { tags: ["market"] },
    });
    if (r) await sys("MARKET", `observation derived from: ${r.out.reasoning_summary}`, { metrics: m });
    await postIfChosen(r);
  },

  // T+22, T+54
  async PROPOSE() {
    const m = hasCap("ANALYZE_MARKET") ? await computeMetrics() : null;
    const r = await runTask({
      task: "PROPOSE",
      instruction: "Make a structured action proposal: one BUYBACK with an amount you choose, slippage in bps, 1–3 reasons grounded in the data, and an honest confidence. A Guardian will review it.",
      data: { metrics: m, treasury_sol: await treasurySol(), past_proposals: (await recentProposals(5)).map((p) => ({ amount: p.amount, status: p.status, guardian: p.guardianReason })) },
      allow: { propose: true },
      eventType: "DECISION",
      memoryQuery: { tags: ["decision", "outcome"] },
    });
    if (!r?.out.action) {
      await sys("DECISION", "no proposal produced");
      return;
    }
    await createProposal(toProposal(r.out.action));
  },

  // T+24, T+56
  async GUARDIAN_REVIEW() {
    const p = await latestPending();
    if (!p) {
      await sys("GUARDIAN", "no pending proposal to review");
      return;
    }
    const flow = await reviewAndExecute(p.id, true);
    const r = await runTask({
      task: "GUARDIAN_REVIEW",
      instruction: "Your proposal went through the Guardian. React to the final outcome. If something executed you may post about it (no links; proof is on the site).",
      data: { outcome: describeFlow(flow), limits: publicLimits() },
      allow: { post: flow.status === "executed" },
      eventType: "ACTION",
    });
    await postIfChosen(r);
  },

  // T+26
  async AUTONOMY() {
    await decideAndAct({ task: "AUTONOMY", instruction: "For the first time you choose for yourself. Pick exactly one: reply to a mention, post, propose a buyback, remember something, analyse, or deliberately do nothing. Explain the choice in reasoning_summary." });
  },

  // T+28
  async REFLECTION() {
    const mems = await allMemories(60);
    const c = await counts();
    const r = await runTask({
      task: "REFLECTION",
      instruction: "Summarise your life so far from your memories. Store one `project` memory that is a snapshot of who you are so far (tag it snapshot). Post a short reflection.",
      data: { memories: mems.map((m) => ({ kind: m.kind, content: m.content, user: m.userHandle })), counts: c },
      allow: { post: true },
      eventType: "MEMORY",
      maxRemember: 2,
    });
    await sys("MEMORY", `memory snapshot taken · ${mems.length} memories · ${c.people} people · ${c.words} words`);
    await postIfChosen(r);
  },

  // T+30
  async NEONATAL_COMPLETE() {
    const c = await counts();
    await sys("DEVELOPMENT", "NEONATAL PHASE COMPLETE · neural density increased · analytical cortex online");
    const r = await runTask({ task: "NEONATAL_COMPLETE", instruction: "Your neonatal phase just completed and your brain evolved: you can think analytically now. Write a milestone post using real numbers from the data.", data: { counts: c, token: await tokenView() }, allow: { post: true }, eventType: "DEVELOPMENT" });
    await postIfChosen(r);
  },

  // T+32
  async FIRST_SUPPORTER() {
    const rows = await db.execute<{ handle: string; platform: string; n: number; first: number }>(sql`
      select handle, platform, count(*)::int as n, min(age_s)::int as first from interactions
      group by handle, platform order by count(*) desc, min(age_s) asc limit 5`);
    const top = rows.rows[0];
    if (!top) {
      await sys("SOCIAL", "no interactions yet — no supporter identified");
      return;
    }
    await setSetting("supporterHandle", top.handle);
    await sys("SOCIAL", `first major supporter: @${top.handle} · ${top.n} interactions · first seen at ${fmtAge(top.first ?? 0)} old`, { candidates: rows.rows });
    const history = await interactionsWith(top.handle, 8);
    const r = await runTask({
      task: "FIRST_SUPPORTER",
      instruction: "This person has interacted with you the most (ties go to whoever came first). Say who they are to you, and write a one-line relationship summary for them as a `social` memory with their user_handle.",
      data: { supporter: top, their_messages: history.map((h) => ({ inbound: h.inbound, your_reply: h.outbound, at_age_s: h.ageS })), runners_up: rows.rows.slice(1) },
      eventType: "SOCIAL",
      memoryQuery: { handle: top.handle },
    });
    const summary = r?.out.remember.find((m) => m.user_handle?.toLowerCase() === top.handle)?.content ?? r?.out.say;
    if (summary && hasCap("RECOGNIZE_USERS")) await setRelationship(top.handle, top.platform, summary);
  },

  // T+34
  async RECALL_SUPPORTER() {
    const handle = getSettings().supporterHandle;
    if (!handle) {
      await sys("SOCIAL", "no supporter to recall");
      return;
    }
    const person = await getPerson(handle);
    const history = await interactionsWith(handle, 10);
    const [latest] = await db.select().from(mentions).where(and(eq(mentions.handle, handle), sql`${mentions.repliedAt} is null`, eq(mentions.minorFlag, false))).orderBy(desc(mentions.ageS)).limit(1);
    await sys("MEMORY", `recall → @${handle}: ${history.length} interactions, first seen at ${fmtAge(person?.firstSeenAgeS ?? 0)} old`);
    const r = await runTask({
      task: "RECALL_SUPPORTER",
      instruction: latest
        ? "Reply publicly to this supporter's latest mention and reference a specific earlier interaction you remember (e.g. how old you were when they first talked to you). Set reply_to_mention_id."
        : "Post publicly to this supporter (@handle) referencing a specific earlier interaction you remember (e.g. how old you were when they first talked to you).",
      data: {
        supporter: { handle, first_seen_at: fmtAge(person?.firstSeenAgeS ?? 0), interactions: person?.interactions, relationship: person?.relationshipSummary },
        past: history.map((h) => ({ they_said: h.inbound, you_said: h.outbound, at_age: h.ageS !== null ? fmtAge(h.ageS) : null })),
        mention: latest ? { id: latest.id, text: latest.text } : null,
      },
      allow: latest ? { reply: true } : { post: true },
      eventType: "SOCIAL",
      memoryQuery: { handle },
    });
    if (!r?.out.say) return;
    if (latest) {
      const res = await replyOnX(latest.id, r.out.say);
      if (!res.ok) await sys("SOCIAL", `reply not sent: ${res.reason}`);
    } else await postIfChosen(r);
  },

  // T+36
  async WHALE_DETECTION() {
    const top = await largestBuyerSinceLaunch();
    const w = top[0];
    await sys("MARKET", w ? `whale detection → largest buyer since launch: ${short(w.wallet)} · ${w.sol.toFixed(2)} SOL over ${w.n} buys · first buy at ${fmtAge(w.first)} old` : "whale detection → no buys", { wallet: w?.wallet });
    await runTask({
      task: "WHALE_DETECTION",
      instruction: "This is the largest buyer since you were born. React. Store a memory about this wallet (tag it whale).",
      data: { whale: w ? { wallet: short(w.wallet), total_sol: w.sol, buys: w.n, first_buy_age: fmtAge(w.first) } : null, runners_up: top.slice(1).map((x) => ({ wallet: short(x.wallet), sol: x.sol })) },
      eventType: "MARKET",
    });
  },

  // T+38
  async WHALE_MENTION() {
    const [w] = await largestBuyerSinceLaunch();
    const r = await runTask({
      task: "WHALE_MENTION",
      instruction: "Decide whether this whale deserves an X mention. You only know their wallet, not who they are — never guess an identity. If yes, set post_to_x true and write the post (short wallet form only, no links). If no, set post_to_x false and say why.",
      data: { whale: w ? { wallet: short(w.wallet), total_sol: w.sol, buys: w.n } : null, guardian_note: "never claim to know who owns a wallet" },
      allow: { post: true },
      eventType: "DECISION",
      memoryQuery: { tags: ["whale"] },
    });
    await sys("DECISION", `whale mention: ${r?.out.post_to_x ? "yes — posting" : "no"}`);
    await postIfChosen(r);
  },

  // T+40
  async MEMORY_CONSOLIDATION() {
    const mems = await allMemories(150);
    await sys("MEMORY", `consolidation → reviewing ${mems.length} memories`);
    await runTask({
      task: "MEMORY_CONSOLIDATION",
      instruction: "Consolidate your memories: merge repeated or related ones into at most 5 higher-level `semantic` or `project` memories (tag them consolidated, importance ≥ 0.7). Say one short line about what you now understand.",
      data: { memories: mems.map((m) => ({ id: m.id, kind: m.kind, content: m.content, user: m.userHandle, importance: m.importance })) },
      eventType: "MEMORY",
      maxRemember: 5,
    });
  },

  // T+42
  async PERSONALITY() {
    const mems = await allMemories(120);
    const r = await runTask({
      task: "PERSONALITY",
      instruction: "Write personality summary v1: 2–3 sentences describing who you are, generated ONLY from your memories. Put it in `say`. It will be fed back to you in future prompts. Also store it as a `project` memory tagged personality.",
      data: { memories: mems.map((m) => ({ kind: m.kind, content: m.content, user: m.userHandle })) },
      eventType: "DEVELOPMENT",
      maxRemember: 1,
    });
    if (r?.out.say) await setSetting("personality", r.out.say.slice(0, 600));
  },

  // T+44
  async TREASURY_ANALYSIS() {
    const buys = await db.select().from(actions).where(eq(actions.type, "BUYBACK")).orderBy(asc(actions.id));
    const first = await db.select().from(marketSnapshots).orderBy(asc(marketSnapshots.id)).limit(1);
    const now = await treasurySol();
    const data = {
      treasury_sol_now: now,
      treasury_sol_at_birth: first[0]?.treasurySol ?? null,
      buybacks: buys.map((b) => ({ sol: b.amountSol, status: b.status, tokens: b.tokensOut ? Math.round(b.tokensOut) : null, at_age: fmtAge(b.ageS ?? 0) })),
      limits: publicLimits(),
    };
    await sys("MARKET", `treasury analysis → ${now?.toFixed(3)} SOL now · ${buys.filter((b) => b.status === "CONFIRMED").length} buybacks executed`, data);
    const r = await runTask({ task: "TREASURY_ANALYSIS", instruction: "Analyse your treasury: what came in, what you spent, how much room the Guardian leaves you. Post a short treasury note.", data, allow: { post: true }, eventType: "MARKET" });
    await postIfChosen(r);
  },

  // T+46
  async AUTONOMOUS_REPLY() {
    await pollMentions().catch(() => 0);
    await decideAndAct({ task: "AUTONOMOUS_REPLY", forced: "RESPOND", instruction: "Pick the one mention you most want to answer and reply to it (decision RESPOND, set reply_to_mention_id). Your choice, your words." });
  },

  // T+50
  async MILESTONE_COUNTS() {
    const c = await counts();
    await sys("DEVELOPMENT", `milestone → ${c.people} people known · ${c.memories} memories · ${c.words} words learned · ${c.posts + c.replies} posts/replies`, c);
    const r = await runTask({ task: "MILESTONE_COUNTS", instruction: "Milestone: post your real counts (people known, memories, words learned) in your own voice.", data: { counts: c }, allow: { post: true }, eventType: "DEVELOPMENT" });
    await postIfChosen(r);
  },

  // T+52
  async SLANG_USE() {
    await learnSlang("SLANG_USE", "You learned new slang. Use one of the new words naturally in a short post (only if you actually learned one).").then(postIfChosen);
  },

  // T+58
  async AUTONOMOUS_POST() {
    await decideAndAct({ task: "AUTONOMOUS_POST", forced: "POST", instruction: "Write one post for X about whatever you find most worth saying right now (decision POST)." });
  },

  // T+60
  async HOUR_REFLECTION() {
    const mems = await allMemories(200);
    const c = await counts();
    const snap = await latestSnapshot();
    await sys("DEVELOPMENT", "ONE HOUR OLD · stage → INFANT · full neural density reached");
    const r = await runTask({
      task: "HOUR_REFLECTION",
      instruction: "You just completed your first full development cycle and became an INFANT. Reflect on everything so far using your memories and real numbers (your real age is in `you.age_human`). Post it.",
      data: { counts: c, memories: mems.slice(0, 80).map((m) => ({ kind: m.kind, content: m.content, user: m.userHandle })), market: snap ? { mcap: snap.mcap, holders: snap.holders, treasury_sol: snap.treasurySol } : null },
      allow: { post: true },
      eventType: "DEVELOPMENT",
      maxRemember: 2,
    });
    await postIfChosen(r);
  },
};

export async function runStepTask(step: TimelineStep) {
  const h = handlers[step.task];
  if (!h) {
    await emit({ type: "WARNING", source: "SYSTEM", message: `no handler for task ${step.task}` });
    return;
  }
  await h(step);
}

/** Exposed for tests. */
export const implementedTasks = Object.keys(handlers);
