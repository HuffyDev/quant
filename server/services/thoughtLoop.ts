import { desc, eq, gt, and, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { actions, events } from "../db/schema";
import { THOUGHTS } from "../config/limits";
import { stageAt } from "../config/timeline";
import { hasCap } from "./capabilities";
import { ageS, fmtAge, realMs } from "./clock";
import { emit } from "./events";
import { firedMap } from "./engine";
import { latestSnapshot } from "./market";
import { knownWords } from "./memory";
import { runTask } from "./orchestrator";
import { postToX } from "./social";
import { getSettings } from "./settings";
import { queue } from "./queue";
import { resetHooks } from "./resetHooks";

/**
 * Thought posts: from birth, at a random interval between THOUGHT_POST_MIN_S and THOUGHT_POST_MAX_S baby-seconds,
 * Baby posts a short tweet about growing up. Nothing is scripted: the model writes each one in the current stage
 * voice (babble → confused toddler logic → sharp), fed with what actually happened to it since the last thought.
 * Every post goes through postToX (kill switch, content filter, daily X budget).
 */

let timer: NodeJS.Timeout | null = null;
let lastThoughtAge = -Infinity;
resetHooks.push(() => {
  lastThoughtAge = -Infinity;
});

async function context(age: number) {
  const since = Number.isFinite(lastThoughtAge) ? lastThoughtAge : age - 180;
  const recent = await db
    .select({ type: events.type, source: events.source, message: events.message })
    .from(events)
    .where(and(gt(events.ageS, since), inArray(events.type, ["DEVELOPMENT", "BIRTH", "LEARN", "MEMORY", "SOCIAL", "MARKET", "ACTION", "GUARDIAN", "DECISION"])))
    .orderBy(desc(events.id))
    .limit(12);
  const myPosts = await db.select({ text: actions.summary }).from(actions).where(eq(actions.type, "X_POST")).orderBy(desc(actions.id)).limit(8);
  const snap = hasCap("READ_TOKEN") ? await latestSnapshot() : null;
  return {
    age_human: fmtAge(age),
    stage: stageAt(age),
    development_steps_reached: firedMap().size,
    happened_since_last_thought: recent.reverse().map((e) => `${e.source === "BABY" ? "you" : e.type.toLowerCase()}: ${e.message.slice(0, 140)}`),
    your_recent_posts_do_not_repeat: myPosts.map((p) => p.text).filter(Boolean),
    words_you_know: hasCap("LEARN_SLANG") ? (await knownWords()).map((w) => w.term) : [],
    token: snap ? { mcap_usd: snap.mcap ? Math.round(snap.mcap) : null, holders: snap.holders, treasury_sol: snap.treasurySol } : undefined,
  };
}

async function thinkAndPost() {
  const age = ageS();
  if (age === null || !hasCap("POST_X") || getSettings().xPaused) return;
  lastThoughtAge = age;
  const r = await runTask({
    task: "THOUGHT",
    instruction:
      "Post one short, spontaneous tweet about being a newborn AI growing up in public — what you just noticed, felt, learned or misunderstood. Base it on what actually happened (see data). Feel alive and a little funny. Never repeat or closely echo your recent posts. One thought, under 200 characters. Set post_to_x true.",
    data: await context(age),
    allow: { post: true },
    eventType: "SOCIAL",
    maxRemember: 0,
  });
  if (!r?.out.say) return;
  const res = await postToX(r.out.say, { summary: r.out.say });
  if (!res.ok) await emit({ type: "SOCIAL", source: "SYSTEM", message: `thought not posted: ${res.reason}` });
}

export function startThoughtLoop() {
  if (timer || !THOUGHTS.ENABLED) return;
  const schedule = (babyS: number) => {
    timer = setTimeout(tick, Math.max(1000, realMs(babyS)));
  };
  const next = () => THOUGHTS.MIN_S + Math.random() * Math.max(0, THOUGHTS.MAX_S - THOUGHTS.MIN_S);
  const tick = () => {
    // wait for the birth post ("hi") before the first thought
    if (!firedMap().has("birth")) return schedule(5);
    // queue behind whatever Baby is doing (jobs run one at a time), but never stack thoughts
    if (!queue.has("thought")) queue.push("thought", thinkAndPost);
    schedule(next());
  };
  schedule(next());
}
