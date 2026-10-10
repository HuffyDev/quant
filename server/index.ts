import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { Server as IOServer } from "socket.io";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { env, llmProvider } from "./env";
import { db, runMigrations } from "./db/client";
import { timelineFired } from "./db/schema";
import { loadSettings } from "./services/settings";
import { loadCapabilities } from "./services/capabilities";
import { attachIO, emit } from "./services/events";
import { loadFired, startEngine } from "./services/engine";
import { getState, setVerifiedXHandle, startStateBroadcaster } from "./services/state";
import { publicRoutes, recentEvents } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { proofRoutes } from "./routes/proof";
import { initAdapters } from "./services/adapters";
import { rebuildSimWorld, simWorld } from "./services/adapters/sim";
import { startMarketPoller } from "./services/market";
import { initSocialState, startMentionPoller } from "./services/social";
import { startAutonomyLoop } from "./services/autonomy";
import { startReplyLoop } from "./services/replyLoop";
import { startThoughtLoop } from "./services/thoughtLoop";
import { loadArc, startArc } from "./services/arc";
import { startProbes, STREAM_ROOM } from "./services/probes";
import { streamKeyOk } from "./streamKey";
import { getSettings, setSetting } from "./services/settings";
import { isSim } from "./env";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await runMigrations();
  await loadSettings();
  await loadCapabilities();
  await loadFired();
  await loadArc();
  await initAdapters();
  if (isSim) {
    await rebuildSimWorld();
    if (!getSettings().tokenMint) {
      await setSetting("tokenMint", simWorld().mint);
      await setSetting("tokenName", "ROOT");
      await setSetting("tokenSymbol", "ROOT");
    }
  }
  await initSocialState();
  if (!isSim) {
    const { initXIdentity } = await import("./services/adapters/live/x");
    const x = await initXIdentity();
    setVerifiedXHandle(x.handle);
    for (const w of x.warnings) {
      console.warn(`[x] ${w}`);
      await emit({ type: "WARNING", source: "SYSTEM", message: w });
    }
  }

  // A step whose task was mid-flight when the process died is NOT re-run (it may already have posted / traded).
  const interrupted = await db.update(timelineFired).set({ status: "interrupted" }).where(eq(timelineFired.status, "running")).returning();
  for (const r of interrupted)
    await emit({ type: "WARNING", source: "SYSTEM", message: `restart: step ${r.stepId} was interrupted mid-task and will not be re-run`, data: { stepId: r.stepId } });

  const app = Fastify({ logger: false, trustProxy: (_addr: string, hop: number) => hop < env.TRUST_PROXY_HOPS, bodyLimit: 64 * 1024 });
  await app.register(publicRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/admin/api" });
  await app.register(proofRoutes);

  const dist = path.resolve(here, "../dist");
  if (fs.existsSync(dist)) {
    // OG / Twitter tags need absolute URLs: fill in PUBLIC_SITE_URL once at boot
    const site = (env.PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    const indexHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8").replaceAll("__SITE_URL__", site);
    const sendIndex = (reply: import("fastify").FastifyReply) => reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").send(indexHtml);
    // /stream: private OBS page. Explicit route (never the SPA fallback), secret key, never indexed.
    const streamHtml = indexHtml.replace("<head>", '<head>\n    <meta name="robots" content="noindex, nofollow, noarchive" />');
    await app.register(fastifyStatic, { root: dist, wildcard: false, index: false });
    app.get("/", (_req, reply) => sendIndex(reply));
    app.get<{ Querystring: { key?: string } }>("/stream", (req, reply) => {
      if (!streamKeyOk(req.query.key)) return reply.code(404).header("x-robots-tag", "noindex").type("text/plain").send("Not Found");
      return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").header("x-robots-tag", "noindex, nofollow, noarchive").send(streamHtml);
    });
    app.setNotFoundHandler((req, reply) => {
      if (/^\/(api|admin\/api|sim|proof|models|stream|media|assets)\//.test(req.url)) return reply.code(404).send({ error: "not found" });
      return sendIndex(reply);
    });
  }

  await app.ready();
  const io = new IOServer(app.server, {
    cors: { origin: env.NODE_ENV === "production" ? false : "*" },
    serveClient: false,
    perMessageDeflate: { threshold: 1024 },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });
  attachIO(io);
  // initial payload is shared by every connecting client (cached ≤1s) so a reconnect storm costs O(1) DB work
  let initial: { at: number; events: Awaited<ReturnType<typeof recentEvents>> } | null = null;
  io.on("connection", async (socket) => {
    // /stream overlays authenticate with the key to receive self-probes (never sent to public clients)
    socket.on("stream:join", (key: unknown, ack?: (ok: boolean) => void) => {
      const ok = streamKeyOk(typeof key === "string" ? key : undefined);
      if (ok) void socket.join(STREAM_ROOM);
      if (typeof ack === "function") ack(ok);
    });
    socket.emit("state", await getState());
    if (!initial || Date.now() - initial.at > 1000) initial = { at: Date.now(), events: await recentEvents(150) };
    socket.emit("events", initial.events);
  });

  startStateBroadcaster();
  startArc();
  startProbes();
  if (!env.STREAM_KEY) console.warn("[stream] STREAM_KEY not set: /stream is disabled (404)");
  startEngine();
  startMarketPoller();
  startMentionPoller();
  startAutonomyLoop();
  startReplyLoop();
  startThoughtLoop();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`ROOT up on :${env.PORT}  MODE=${env.MODE}${env.MODE === "sim" ? `  SIM_SPEED=${env.SIM_SPEED}` : ""}  LLM=${llmProvider}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
