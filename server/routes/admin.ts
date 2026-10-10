import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env, isSim } from "../env";
import { emit, markDirty } from "../services/events";
import { getSettings, setSetting } from "../services/settings";
import { adminStatus, skipStep } from "../services/engine";
import { resetSim } from "../services/reset";

function authorized(req: FastifyRequest): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const h = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? (req.headers["x-admin-token"] as string | undefined);
  if (!h) return false;
  const a = Buffer.from(h);
  const b = Buffer.from(env.ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function human(what: string, data?: Record<string, unknown>) {
  await emit({ type: "WARNING", source: "HUMAN", message: `HUMAN SAFETY OVERRIDE ACTIVATED — ${what}`, data });
}

const flagsBody = z.object({
  xPaused: z.boolean().optional(),
  chatPaused: z.boolean().optional(),
  treasuryFrozen: z.boolean().optional(),
  autonomyEnabled: z.boolean().optional(),
});

type Flag = "xPaused" | "chatPaused" | "treasuryFrozen" | "autonomyEnabled";
const flagText: Record<Flag, [string, string]> = {
  xPaused: ["X posting paused", "X posting resumed"],
  chatPaused: ["web chat paused", "web chat resumed"],
  treasuryFrozen: ["treasury frozen", "treasury unfrozen"],
  autonomyEnabled: ["autonomous loop enabled", "autonomous loop disabled"],
};

const launchBody = z.object({
  launchAt: z.union([z.literal("now"), z.string().datetime({ offset: true }), z.null()]).optional(),
  tokenMint: z.string().min(32).max(64).nullable().optional(),
  tokenName: z.string().max(64).nullable().optional(),
  tokenSymbol: z.string().max(16).nullable().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (!env.ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN not configured" });
    if (!authorized(req)) return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/status", async () => ({ mode: env.MODE, settings: getSettings(), ...(await adminStatus()) }));

  app.post("/flags", async (req, reply) => {
    const body = flagsBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    for (const [k, v] of Object.entries(body.data) as [Flag, boolean | undefined][]) {
      if (v === undefined || getSettings()[k] === v) continue;
      await setSetting(k, v);
      await human(flagText[k][v ? 0 : 1], { flag: k, value: v });
    }
    markDirty();
    return { ok: true, settings: getSettings() };
  });

  app.post("/launch", async (req, reply) => {
    const body = launchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const d = body.data;
    if (d.launchAt !== undefined) {
      const iso = d.launchAt === "now" ? new Date().toISOString() : d.launchAt ? new Date(d.launchAt).toISOString() : null;
      await setSetting("launchAt", iso);
      await human(`LAUNCH_TIMESTAMP set to ${iso ?? "unset"}`, { launchAt: iso });
    }
    for (const k of ["tokenMint", "tokenName", "tokenSymbol"] as const) {
      if (d[k] !== undefined) {
        await setSetting(k, d[k] ?? null);
        await human(`${k} set to ${d[k] ?? "unset"}`, { [k]: d[k] });
      }
    }
    markDirty();
    return { ok: true, settings: getSettings() };
  });

  app.post("/skip-step", async (req, reply) => {
    const body = z.object({ stepId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const res = await skipStep(body.data.stepId);
    if (!res.ok) return reply.code(400).send(res);
    await human(`step ${body.data.stepId} force-skipped`, { stepId: body.data.stepId });
    return res;
  });

  app.post("/sim/run-first-hour", async (_req, reply) => {
    if (!isSim) return reply.code(400).send({ error: "only available in MODE=sim" });
    await resetSim();
    const iso = new Date().toISOString();
    await setSetting("launchAt", iso);
    await human(`sim reset; full first hour started (×${env.SIM_SPEED})`, { launchAt: iso });
    markDirty();
    return { ok: true, launchAt: iso };
  });

  app.post("/sim/reset", async (_req, reply) => {
    if (!isSim) return reply.code(400).send({ error: "only available in MODE=sim" });
    await resetSim();
    await setSetting("launchAt", null);
    await human("sim reset to GESTATING");
    markDirty();
    return { ok: true };
  });
}
