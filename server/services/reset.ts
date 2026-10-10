import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { loadCapabilities } from "./capabilities";
import { loadFired } from "./engine";
import { queue } from "./queue";
import { resetHooks } from "./resetHooks";
import { setSetting } from "./settings";
import { isSim } from "../env";
import { rebuildSimWorld } from "./adapters/sim";

const TABLES = [
  "capabilities",
  "timeline_fired",
  "events",
  "proposals",
  "actions",
  "memories",
  "people",
  "interactions",
  "mentions",
  "slang",
  "market_snapshots",
  "trades",
  "x_spend",
  "chat_messages",
];

/** Sim only: wipe all run state (settings/kill switches are kept). */
export async function resetSim() {
  queue.reset();
  // let an in-flight job finish so it can't write into the freshly truncated tables (bounded wait)
  await Promise.race([queue.idle(), new Promise((r) => setTimeout(r, 45_000))]);
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY`));
  await loadCapabilities();
  await loadFired();
  // clear launch first so the sim world is rebuilt at age 0 (callers set a new launch afterwards)
  await setSetting("launchAt", null);
  await setSetting("personality", null);
  await setSetting("supporterHandle", null);
  if (isSim) await rebuildSimWorld();
  for (const h of resetHooks) await h();
}
