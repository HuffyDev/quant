/**
 * Sim integration: pre-launch arc → LAUNCH → final beat, against a real Postgres with the mock LLM and sim adapters.
 * Needs TEST_DATABASE_URL (a THROWAWAY database: every table is truncated); skipped otherwise.
 *   TEST_DATABASE_URL=postgres://root_app:root_app@localhost:5432/root_test npm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

const URL_ = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL_)("sim: pre-launch arc and launch", () => {
  let m: Awaited<ReturnType<typeof load>>;
  async function load() {
    const client = await import("../db/client");
    const schema = await import("../db/schema");
    const settings = await import("../services/settings");
    const caps = await import("../services/capabilities");
    const engine = await import("../services/engine");
    const arc = await import("../services/arc");
    const adapters = await import("../services/adapters");
    const reset = await import("../services/reset");
    const queue = await import("../services/queue");
    const config = await import("../config/arc");
    const state = await import("../services/state");
    const sim = await import("../services/adapters/sim");
    return { ...sim, ...client, schema, ...settings, ...caps, ...engine, ...arc, ...adapters, ...reset, ...queue, config, ...state };
  }
  const events = () => m.db.select().from(m.schema.events).orderBy(asc(m.schema.events.id));
  const arcEvents = async () => (await events()).filter((e) => e.type === "ARC" && e.source === "ROOT");

  beforeAll(async () => {
    m = await load();
    await m.runMigrations();
    await m.loadSettings();
    await m.initAdapters();
    await m.resetSim();
    await m.setSetting("tokenMint", m.simWorld().mint); // as index.ts does at sim boot
    await m.loadCapabilities();
    await m.loadFired();
    await m.loadArc();
  });
  afterAll(async () => {
    await m?.queue.idle();
    await m?.pool.end();
  });

  it("fires due beats in order, with required readouts, before POST_X is unlocked", async () => {
    const t0 = Date.now() - 1000;
    await m.setSetting("launchAt", null);
    await m.setSetting("arcSpacingS", 60);
    await m.setSetting("arcPaused", false);
    await m.setSetting("arcStartAt", new Date(t0).toISOString());
    expect(m.hasCap("POST_X")).toBe(false);

    // beat 1 due now
    await m.arcTick(t0 + 1000);
    await m.queue.idle();
    // beats 2 and 3 both due (server was "down"): only beat 3 posts, beat 2 is skipped
    await m.arcTick(t0 + 2 * 60_000 + 1000);
    await m.queue.idle();
    // same tick again: nothing re-fires
    await m.arcTick(t0 + 2 * 60_000 + 2000);
    await m.queue.idle();

    const posted = await arcEvents();
    expect(posted.map((e) => (e.data as { beat: string }).beat)).toEqual(["wake", "esc_12"]);
    expect(posted[1].message).toContain("privilege escalation 12%");
    expect(posted.every((e) => e.proofUrl?.startsWith("/sim/x/"))).toBe(true);
    const skipped = (await events()).filter((e) => e.type === "ARC" && (e.data as { skipped?: boolean })?.skipped);
    expect(skipped.map((e) => (e.data as { beat: string }).beat)).toEqual(["scan"]);

    const pub = m.arcPublicView(t0 + 2 * 60_000 + 2000);
    expect(pub.total).toBe(10);
    expect(pub.beats.filter((b) => b.fired).map((b) => b.id)).toEqual(["wake", "esc_12"]);
    expect(pub.nextAt).toBe(new Date(t0 + 3 * 60_000).toISOString());
    expect(JSON.stringify(pub)).not.toContain("directive");
  });

  it("pausing stops beats", async () => {
    const start = new Date(m.getSettings().arcStartAt!).getTime();
    await m.setSetting("arcPaused", true);
    await m.arcTick(start + 3 * 60_000 + 1000);
    await m.queue.idle();
    expect((await arcEvents()).length).toBe(2);
    await m.setSetting("arcPaused", false);
  });

  it("LAUNCH skips the rest and T+0 posts the fixed final beat with the contract address", async () => {
    const mint = m.getSettings().tokenMint!;
    expect(mint).toBeTruthy();
    await m.setSetting("launchAt", new Date(Date.now() - 500).toISOString());
    await m.arcTick();
    await m.tick();
    await m.queue.idle();

    const all = await events();
    const skippedAfterLaunch = all.filter((e) => e.type === "ARC" && /launched before it was due/.test(e.message));
    expect(skippedAfterLaunch).toHaveLength(m.config.ARC_BEATS.length - 3); // wake, scan, esc_12 already handled
    const boot = all.find((e) => e.type === "BOOT" && e.source === "ROOT");
    expect(boot?.message).toBe(`root access granted\n${mint}`);
    const [post] = await m.db.select().from(m.schema.actions).where(eq(m.schema.actions.summary, `root access granted · ${mint}`));
    expect(post?.status).toBe("CONFIRMED");
    const final = (await m.db.select().from(m.schema.timelineFired).where(eq(m.schema.timelineFired.stepId, "arc:root_access")))[0];
    expect(final?.status).toBe("done");
    expect(m.hasCap("POST_X")).toBe(true);

    const st = await m.computeState();
    expect(st.stage).toBe("BREACH");
    expect(st.arc.beats.at(-1)).toMatchObject({ id: "root_access", fired: true });
  });
});
