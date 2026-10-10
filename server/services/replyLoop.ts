import { AUTONOMY } from "../config/limits";
import { hasCap } from "./capabilities";
import { ageS, realMs } from "./clock";
import { emit } from "./events";
import { runTask } from "./orchestrator";
import { replyOnX, topMentions } from "./social";
import { getSettings } from "./settings";
import { queue } from "./queue";

/**
 * Dedicated reply loop (on from birth): every MIN_SECONDS_BETWEEN_REPLIES baby-seconds, answer the best-ranked
 * unanswered mention from the last 15 minutes. The voice comes from the stage prompt, so early replies are
 * confused babble and later ones make sense. All the usual gates still apply inside replyOnX
 * (REPLY_X capability, X kill switch, content filter, minor block, shared reply cap, daily X budget).
 */
const MIN_RANK = 0.25; // spam/scams are ranked 0
const FRESH_S = 900;

let timer: NodeJS.Timeout | null = null;

async function replyOnce() {
  if (!hasCap("REPLY_X") || !hasCap("READ_X") || getSettings().xPaused) return;
  const age = ageS() ?? 0;
  const [m] = await topMentions(1, { unrepliedOnly: true, sinceAge: age - FRESH_S });
  if (!m || (m.rank ?? 0) < MIN_RANK) return;
  const r = await runTask({
    task: "REPLY_LOOP",
    instruction: "Someone tagged you on X. Reply to them in your current voice (set reply_to_mention_id to their mention id). Keep it short.",
    data: { mention: { id: m.id, handle: m.handle, text: m.text, followers: m.followers } },
    allow: { reply: true },
    eventType: "SOCIAL",
    memoryQuery: { handle: m.handle },
    maxRemember: 1,
  });
  if (!r?.out.say) return;
  const res = await replyOnX(m.id, r.out.say);
  if (!res.ok && !/reply cap/.test(res.reason ?? "")) await emit({ type: "SOCIAL", source: "SYSTEM", message: `reply to @${m.handle} not sent: ${res.reason}` });
}

export function startReplyLoop() {
  if (timer) return;
  const tick = () => {
    if (!queue.busy) queue.push("reply", replyOnce);
    timer = setTimeout(tick, Math.max(1000, realMs(AUTONOMY.MIN_SECONDS_BETWEEN_REPLIES)));
  };
  timer = setTimeout(tick, 2000);
}
