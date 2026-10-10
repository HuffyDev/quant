import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { interactions, memories, people, slang } from "../db/schema";
import { MEMORY_KINDS } from "./llm";
import { ageS } from "./clock";
import { emit, markDirty } from "./events";
import { hasCap, requireCap } from "./capabilities";

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface NewMemory {
  kind: MemoryKind;
  content: string;
  userHandle?: string | null;
  tags?: string[];
  importance?: number;
}

const normHandle = (h: string | null | undefined) => (h ? h.replace(/^@/, "").trim().toLowerCase().slice(0, 32) || null : null);

// ── interactions (system log — always recorded, regardless of capabilities) ──
export async function logInteraction(i: { handle: string; platform: "x" | "web"; inbound?: string | null; outbound?: string | null; xPostId?: string | null; meta?: Record<string, unknown> }) {
  const handle = normHandle(i.handle);
  if (!handle) return;
  await db.insert(interactions).values({ handle, platform: i.platform, inbound: i.inbound ?? null, outbound: i.outbound ?? null, xPostId: i.xPostId ?? null, meta: i.meta ?? null, ageS: ageS() });
  if (hasCap("RECOGNIZE_USERS")) await touchPerson(handle, i.platform);
}

async function touchPerson(handle: string, platform: string, firstSeenAgeS?: number) {
  await db
    .insert(people)
    .values({ handle, platform, firstSeenAgeS: firstSeenAgeS ?? ageS() ?? 0, interactions: 1, lastSeen: new Date() })
    .onConflictDoUpdate({
      target: [people.handle, people.platform],
      set: { interactions: sql`${people.interactions} + 1`, lastSeen: new Date() },
    });
  markDirty();
}

/** At T+14 (RECOGNIZE_USERS): build the people table from every interaction logged so far. */
export async function backfillPeople(): Promise<number> {
  requireCap("RECOGNIZE_USERS");
  const rows = await db.execute<{ handle: string; platform: string; first: number; n: number; last: Date }>(sql`
    select handle, platform, min(age_s)::int as first, count(*)::int as n, max(ts) as last
    from interactions group by handle, platform`);
  for (const r of rows.rows) {
    await db
      .insert(people)
      .values({ handle: r.handle, platform: r.platform, firstSeenAgeS: r.first ?? 0, interactions: r.n, lastSeen: new Date(r.last) })
      .onConflictDoUpdate({ target: [people.handle, people.platform], set: { interactions: r.n, firstSeenAgeS: r.first ?? 0 } });
  }
  markDirty();
  return rows.rows.length;
}

export async function getPerson(handle: string) {
  const h = normHandle(handle);
  if (!h) return null;
  const [p] = await db.select().from(people).where(eq(people.handle, h)).orderBy(desc(people.interactions)).limit(1);
  return p ?? null;
}

export async function setRelationship(handle: string, platform: string, summary: string) {
  requireCap("RECOGNIZE_USERS");
  await db.update(people).set({ relationshipSummary: summary.slice(0, 200) }).where(and(eq(people.handle, normHandle(handle)!), eq(people.platform, platform)));
  markDirty();
}

export async function interactionsWith(handle: string, limit = 10) {
  const h = normHandle(handle);
  if (!h) return [];
  return db.select().from(interactions).where(eq(interactions.handle, h)).orderBy(desc(interactions.id)).limit(limit);
}

// ── long-term memory ──
export async function remember(m: NewMemory, opts: { silent?: boolean } = {}) {
  requireCap("LONG_TERM_MEMORY");
  const content = m.content.trim().slice(0, 400);
  if (!content) return null;
  const [row] = await db
    .insert(memories)
    .values({
      kind: m.kind,
      content,
      userHandle: normHandle(m.userHandle),
      tags: (m.tags ?? []).map((t) => t.toLowerCase().slice(0, 24)).slice(0, 6),
      importance: Math.max(0, Math.min(1, m.importance ?? 0.5)),
      ageS: ageS(),
    })
    .returning();
  if (!opts.silent)
    await emit({ type: "MEMORY", source: "BABY", message: `stored ${row.kind} memory: ${row.content}`, data: { memoryId: row.id, userHandle: row.userHandle, tags: row.tags } });
  markDirty();
  return row;
}

/** Retrieval v1: recent + same user + keyword/tag match. Returns [] while memory is locked. */
export async function recall(q: { handle?: string | null; keywords?: string[]; tags?: string[]; limit?: number } = {}) {
  if (!hasCap("LONG_TERM_MEMORY")) return [];
  const limit = q.limit ?? 12;
  const recent = await db.select().from(memories).orderBy(desc(memories.id)).limit(6);
  const important = await db.select().from(memories).orderBy(desc(memories.importance), desc(memories.id)).limit(4);
  const conds = [];
  const h = normHandle(q.handle);
  if (h) conds.push(eq(memories.userHandle, h));
  if (q.tags?.length) conds.push(sql`${memories.tags} && ARRAY[${sql.join(q.tags.map((t) => sql`${t.toLowerCase()}`), sql`, `)}]::text[]`);
  for (const k of (q.keywords ?? []).filter((k) => k.length >= 3).slice(0, 6)) conds.push(ilike(memories.content, `%${k.replace(/[%_]/g, "")}%`));
  const matched = conds.length ? await db.select().from(memories).where(or(...conds)).orderBy(desc(memories.importance), desc(memories.id)).limit(limit) : [];
  const seen = new Set<number>();
  const out = [];
  for (const m of [...matched, ...important, ...recent]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

export async function allMemories(limit = 200) {
  return db.select().from(memories).orderBy(desc(memories.id)).limit(limit);
}

// ── slang ──
export async function knownWords() {
  return db.select().from(slang).orderBy(slang.learnedAtAgeS);
}

export async function learnWord(term: string, definition: string, sourceHandle?: string | null) {
  requireCap("LEARN_SLANG");
  const t = term.toLowerCase().trim().slice(0, 32);
  if (!t || t.length < 2) return null;
  const rows = await db
    .insert(slang)
    .values({ term: t, definition: definition.trim().slice(0, 200), learnedAtAgeS: ageS() ?? 0, sourceHandle: normHandle(sourceHandle) })
    .onConflictDoNothing()
    .returning();
  if (!rows.length) return null;
  await emit({ type: "LEARN", source: "BABY", message: `learned "${t}": ${rows[0].definition}`, data: { term: t, sourceHandle: rows[0].sourceHandle } });
  markDirty();
  return rows[0];
}

export async function markWordsUsed(text: string) {
  const words = await knownWords();
  const used = words.filter((w) => new RegExp(`\\b${w.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)).map((w) => w.term);
  if (used.length) await db.update(slang).set({ usedCount: sql`${slang.usedCount} + 1` }).where(inArray(slang.term, used));
  return used;
}
