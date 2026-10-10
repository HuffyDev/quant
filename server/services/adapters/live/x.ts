import { TwitterApi, type TwitterApiReadOnly } from "twitter-api-v2";
import { env } from "../../../env";
import { launchMs, speed } from "../../clock";
import type { Mention, SocialAdapter } from "../types";

/**
 * X API v2 (pay-per-use). Only: mentions timeline, post, reply.
 * Quote-posts and likes are not available on pay-per-use and are deliberately not implemented.
 */
let writer: TwitterApi | null = null;
let reader: TwitterApiReadOnly | null = null;
let handle: string | null = env.X_BOT_HANDLE ?? null;
let userId: string | null = env.X_BOT_USER_ID ?? null;

function getWriter(): TwitterApi {
  if (writer) return writer;
  if (!env.X_API_KEY || !env.X_API_SECRET || !env.X_ACCESS_TOKEN || !env.X_ACCESS_SECRET)
    throw new Error("X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET are required to post");
  writer = new TwitterApi({ appKey: env.X_API_KEY, appSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET });
  return writer;
}

function getReader(): TwitterApiReadOnly {
  if (reader) return reader;
  reader = env.X_BEARER_TOKEN ? new TwitterApi(env.X_BEARER_TOKEN).readOnly : getWriter().readOnly;
  return reader;
}

const hasUserCreds = () => !!(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);

/**
 * Startup identity check: GET /2/users/me with the OAuth 1.0a user credentials and use the returned id/handle.
 * Warns (never crashes) if it disagrees with X_BOT_USER_ID / X_BOT_HANDLE, or if the call fails.
 * Returns the warnings so the caller can log them publicly.
 */
export async function initXIdentity(): Promise<{ id: string | null; handle: string | null; warnings: string[] }> {
  const warnings: string[] = [];
  if (!hasUserCreds()) {
    warnings.push("X OAuth 1.0a credentials missing — cannot verify bot identity via /2/users/me; using X_BOT_USER_ID/X_BOT_HANDLE from env");
    return { id: userId, handle, warnings };
  }
  try {
    const u = await getWriter().v2.me();
    if (env.X_BOT_USER_ID && env.X_BOT_USER_ID !== u.data.id)
      warnings.push(`X_BOT_USER_ID=${env.X_BOT_USER_ID} differs from /2/users/me id ${u.data.id} (@${u.data.username}) — using ${u.data.id}`);
    if (env.X_BOT_HANDLE && env.X_BOT_HANDLE.replace(/^@/, "").toLowerCase() !== u.data.username.toLowerCase())
      warnings.push(`X_BOT_HANDLE=${env.X_BOT_HANDLE} differs from /2/users/me username @${u.data.username} — using @${u.data.username}`);
    userId = u.data.id;
    handle = u.data.username;
    identityVerified = true;
    console.log(`[x] authenticated as @${handle} (id ${userId})`);
  } catch (e) {
    warnings.push(`X /2/users/me failed: ${e instanceof Error ? e.message : String(e)} — falling back to X_BOT_USER_ID/X_BOT_HANDLE`);
  }
  return { id: userId, handle, warnings };
}

let identityVerified = false;

async function me() {
  if (userId && handle && (identityVerified || !hasUserCreds())) return { handle, userId };
  const r = await initXIdentity();
  if (!r.id) throw new Error("X bot user id unknown: set X OAuth 1.0a credentials or X_BOT_USER_ID");
  return { handle: r.handle ?? "i", userId: r.id };
}

/** Bot handle as verified at startup (for the site's X link). */
export function xHandle() {
  return handle;
}

const statusUrl = (id: string) => `https://x.com/${handle ?? "i"}/status/${id}`;

export const liveX: SocialAdapter = {
  simulated: false,

  async fetchMentions(sinceId, maxResults) {
    const { userId: id } = await me();
    const res = await getReader().v2.userMentionTimeline(id, {
      ...(sinceId ? { since_id: sinceId } : {}),
      max_results: Math.max(5, Math.min(100, maxResults)),
      expansions: ["author_id"],
      "tweet.fields": ["created_at", "public_metrics", "author_id"],
      "user.fields": ["username", "public_metrics"],
    });
    const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));
    const launch = launchMs() ?? Date.now();
    const out: Mention[] = [];
    for (const t of res.tweets ?? []) {
      const u = t.author_id ? users.get(t.author_id) : undefined;
      if (!u || u.id === id) continue;
      const created = t.created_at ? new Date(t.created_at).getTime() : Date.now();
      out.push({
        id: t.id,
        ageS: Math.max(0, Math.floor(((created - launch) / 1000) * speed)),
        handle: u.username,
        text: t.text,
        followers: u.public_metrics?.followers_count ?? 0,
        likes: t.public_metrics?.like_count ?? 0,
        replies: t.public_metrics?.reply_count ?? 0,
        minorFlag: false, // content-based minor detection runs in social.ts
      });
    }
    return out;
  },

  async post(text) {
    await me();
    const r = await getWriter().v2.tweet(text);
    return { id: r.data.id, url: statusUrl(r.data.id) };
  },

  async reply(inReplyToId, text) {
    await me();
    const r = await getWriter().v2.reply(text, inReplyToId);
    return { id: r.data.id, url: statusUrl(r.data.id) };
  },
};
