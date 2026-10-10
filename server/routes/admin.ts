import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env, isSim } from "../env";
import { emit, markDirty } from "../services/events";
import { getSettings, setSetting } from "../services/settings";
import { adminStatus, skipStep } from "../services/engine";
import { resetSim } from "../services/reset";
import { arcAdminView, skipBeatById, validateArcSchedule } from "../services/arc";
import { isValidMint } from "../../shared/mint";

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
  tokenMint: z.string().refine(isValidMint, "not a valid Solana mint address").nullable().optional(),
  tokenName: z.string().max(64).nullable().optional(),
  tokenSymbol: z.string().max(16).nullable().optional(),
});

const arcBody = z.object({
  startAt: z.union([z.literal("now"), z.string().datetime({ offset: true }), z.null()]).optional(),
  spacingS: z.number().positive().optional(),
  paused: z.boolean().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (!env.ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN not configured" });
    if (!authorized(req)) return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/status", async () => ({ mode: env.MODE, settings: getSettings(), arc: await arcAdminView(), ...(await adminStatus()) }));

  app.post("/arc", async (req, reply) => {
    const body = arcBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const d = body.data;
    if (d.spacingS !== undefined) {
      const bad = validateArcSchedule(d.spacingS);
      if (bad) return reply.code(400).send({ error: bad });
      await setSetting("arcSpacingS", d.spacingS);
      await human(`pre-launch arc spacing set to ${d.spacingS}s`, { arcSpacingS: d.spacingS });
    }
    if (d.startAt !== undefined) {
      const iso = d.startAt === "now" ? new Date().toISOString() : d.startAt ? new Date(d.startAt).toISOString() : null;
      await setSetting("arcStartAt", iso);
      await human(`pre-launch arc start set to ${iso ?? "unset"}`, { arcStartAt: iso });
    }
    if (d.paused !== undefined && d.paused !== getSettings().arcPaused) {
      await setSetting("arcPaused", d.paused);
      await human(d.paused ? "pre-launch arc paused" : "pre-launch arc resumed", { arcPaused: d.paused });
    }
    markDirty();
    return { ok: true, arc: await arcAdminView() };
  });

  app.post("/arc/skip", async (req, reply) => {
    const body = z.object({ beatId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const res = await skipBeatById(body.data.beatId);
    if (!res.ok) return reply.code(400).send(res);
    await human(`arc beat ${body.data.beatId} force-skipped`, { beatId: body.data.beatId });
    return res;
  });

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
    // the T+0 post carries the contract address: in live, refuse to schedule a launch without a valid one
    const mintAfter = d.tokenMint !== undefined ? d.tokenMint : getSettings().tokenMint;
    if (!isSim && d.launchAt && (!mintAfter || !isValidMint(mintAfter)))
      return reply.code(400).send({ error: "set a valid TOKEN_MINT before launching: the final beat posts the contract address" });
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
    await setSetting("arcStartAt", null);
    const iso = new Date().toISOString();
    await setSetting("launchAt", iso);
    await human(`sim reset; full first hour started (×${env.SIM_SPEED})`, { launchAt: iso });
    markDirty();
    return { ok: true, launchAt: iso };
  });

  app.post("/sim/run-arc", async (req, reply) => {
    if (!isSim) return reply.code(400).send({ error: "only available in MODE=sim" });
    const body = z.object({ spacingS: z.number().positive().max(3600).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const spacing = body.data.spacingS ?? 15;
    await resetSim();
    await setSetting("arcSpacingS", spacing);
    await setSetting("arcPaused", false);
    const iso = new Date().toISOString();
    await setSetting("arcStartAt", iso);
    await human(`sim reset; pre-launch arc started (one beat every ${spacing}s) — press LAUNCH NOW for the final beat`, { arcStartAt: iso, arcSpacingS: spacing });
    markDirty();
    return { ok: true, arcStartAt: iso, spacingS: spacing };
  });

  app.post("/sim/reset", async (_req, reply) => {
    if (!isSim) return reply.code(400).send({ error: "only available in MODE=sim" });
    await resetSim();
    await setSetting("launchAt", null);
    await setSetting("arcStartAt", null);
    await human("sim reset to DORMANT");
    markDirty();
    return { ok: true };
  });
}
