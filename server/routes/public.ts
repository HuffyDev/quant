import type { FastifyInstance } from "fastify";
import { desc, lt } from "drizzle-orm";
import { db } from "../db/client";
import { events } from "../db/schema";
import { getState } from "../services/state";
import { chat } from "../services/chat";
import type { PublicEvent } from "../../shared/types";

export function toPublicEvent(r: typeof events.$inferSelect): PublicEvent {
  return {
    id: r.id,
    ts: r.ts.toISOString(),
    ageS: r.ageS,
    type: r.type as PublicEvent["type"],
    source: r.source as PublicEvent["source"],
    message: r.message,
    data: (r.data as Record<string, unknown>) ?? null,
    proofUrl: r.proofUrl,
  };
}

export async function recentEvents(limit = 200, before?: number): Promise<PublicEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(before ? lt(events.id, before) : undefined)
    .orderBy(desc(events.id))
    .limit(limit);
  return rows.reverse().map(toPublicEvent);
}

export async function publicRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));
  app.get("/state", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=1");
    return getState();
  });
  app.post<{ Body: { message?: unknown; handle?: unknown } }>("/chat", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const handle = typeof req.body?.handle === "string" ? req.body.handle : undefined;
    if (!message.trim()) return reply.code(400).send({ error: "empty message" });
    const r = await chat(req.ip, message, handle);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return { reply: r.reply };
  });
  app.get<{ Querystring: { before?: string; limit?: string } }>("/events", async (req) => {
    const limit = Math.min(500, Number(req.query.limit ?? 200) || 200);
    const before = req.query.before ? Number(req.query.before) : undefined;
    return recentEvents(limit, before);
  });
}
