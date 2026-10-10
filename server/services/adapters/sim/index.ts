import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { actions } from "../../../db/schema";
import { ageAt } from "../../clock";
import { getSettings } from "../../settings";
import type { ChainAdapter, ExecutorAdapter, MarketAdapter, SocialAdapter, Trade } from "../types";
import { SIM_SOL_USD, SIM_SUPPLY, SimWorld, fakeB58, rng } from "./world";

let world: SimWorld | null = null;
let tradeCursor = 0;
let postCounter = 0;
const postRng = rng(4242);

export function simWorld(): SimWorld {
  if (!world) world = new SimWorld(getSettings().simSeed);
  return world;
}

const nowAge = () => Math.max(0, ageAt() ?? 0);

/** Rebuild the world from seed + the treasury buys recorded in the DB (restart-safe). */
export async function rebuildSimWorld() {
  world = new SimWorld(getSettings().simSeed);
  tradeCursor = 0;
  const buys = await db
    .select()
    .from(actions)
    .where(and(eq(actions.type, "BUYBACK"), eq(actions.status, "CONFIRMED")))
    .orderBy(asc(actions.ageS));
  for (const b of buys) world.treasuryBuy(b.amountSol ?? 0, b.ageS ?? 0, b.txSig ?? undefined);
  // resume trade ingestion right after the last trade already stored (covers downtime gaps)
  world.advance(nowAge());
  const [r] = (await db.execute<{ max: number | null }>(sql`select max(age_s)::int as max from trades`)).rows;
  const ingestedTo = r?.max ?? -1;
  tradeCursor = world.applied.findIndex((a) => a.ageS >= ingestedTo);
  if (tradeCursor < 0) tradeCursor = world.applied.length;
  postCounter = 0;
}

export const simChain: ChainAdapter = {
  treasuryAddress() {
    return simWorld().treasury;
  },
  async getTokenInfo() {
    const w = simWorld();
    const s = getSettings();
    return { mint: s.tokenMint ?? w.mint, name: s.tokenName ?? "Baby Brain", symbol: s.tokenSymbol ?? "BRAIN", supply: SIM_SUPPLY, decimals: 6 };
  },
  async getTreasurySol() {
    const w = simWorld();
    w.advance(nowAge());
    return w.treasurySol;
  },
  async getHolders(limit = 20) {
    const w = simWorld();
    w.advance(nowAge());
    const list = w.holderList();
    return { count: list.length, top: list.slice(0, limit) };
  },
};

export const simMarket: MarketAdapter = {
  async getSnapshot() {
    const w = simWorld();
    const age = nowAge();
    w.advance(age);
    const priceUsd = w.priceSol * SIM_SOL_USD;
    return {
      priceSol: w.priceSol,
      priceUsd,
      mcapUsd: priceUsd * SIM_SUPPLY,
      liquidityUsd: w.realSol * SIM_SOL_USD * 2,
      vol5mUsd: w.volumeSol(age - 300, age) * SIM_SOL_USD,
      vol1hUsd: w.volumeSol(age - 3600, age) * SIM_SOL_USD,
      migrated: w.migrated,
      bondingCurveProgress: Math.min(1, w.realSol / 85),
    };
  },
  async drainTrades() {
    const w = simWorld();
    w.advance(nowAge());
    const out: Trade[] = w.applied.slice(tradeCursor).map((a) => ({ sig: a.sig, ageS: a.ageS, wallet: a.wallet, side: a.side, sol: a.sol, tokens: a.tokens }));
    tradeCursor = w.applied.length;
    return out;
  },
};

export const simSocial: SocialAdapter = {
  simulated: true,
  async fetchMentions(sinceId, maxResults) {
    const w = simWorld();
    const age = nowAge();
    const handle = "babybrain";
    return w.mentions
      .filter((m) => m.t <= age && (!sinceId || BigInt(m.id) > BigInt(sinceId)))
      .slice(-maxResults) // newest N, like the X API
      .map((m) => ({ id: m.id, ageS: m.t, handle: m.handle, text: m.text.replace("{bot}", `@${handle}`), followers: m.followers, likes: m.likes, replies: m.replies, minorFlag: m.minorFlag }));
  },
  async post(text) {
    void text;
    const id = `sim${Date.now()}${++postCounter}`;
    return { id, url: `/sim/x/${id}` };
  },
  async reply(inReplyToId, text) {
    void inReplyToId;
    void text;
    const id = `sim${Date.now()}${++postCounter}`;
    return { id, url: `/sim/x/${id}` };
  },
};

export const simExecutor: ExecutorAdapter = {
  simulated: true,
  async buyback(amountSol) {
    const sig = "SIM" + fakeB58(postRng, 85);
    const { tokensOut } = simWorld().treasuryBuy(amountSol, nowAge(), sig);
    return { sig, proofUrl: `/sim/tx/${sig}`, tokensOut };
  },
};
