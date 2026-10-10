import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { marketSnapshots, trades } from "../db/schema";
import { getAdapters } from "./adapters";
import { requireCap } from "./capabilities";
import { ageS, realMs } from "./clock";
import { markDirty } from "./events";
import { resetHooks } from "./resetHooks";

let timer: NodeJS.Timeout | null = null;
let n = 0;
let lastHolders: { count: number; top10: number } | null = null;
resetHooks.push(() => {
  n = 0;
  lastHolders = null;
});

/** SYSTEM poller: snapshots + trades for the public site. Not gated (it is not Baby reading). */
export async function pollMarket() {
  const age = ageS();
  if (age === null) return;
  const { market, chain } = getAdapters();
  const [snap, treasury, newTrades] = await Promise.all([market.getSnapshot(), chain.getTreasurySol(), market.drainTrades()]);
  if (n++ % 6 === 0 || !lastHolders) {
    const h = await chain.getHolders(10);
    if (h) lastHolders = { count: h.count, top10: h.top.slice(0, 10).reduce((a, x) => a + x.pct, 0) };
  }
  const treasuryPk = chain.treasuryAddress();
  if (newTrades.length) {
    await db
      .insert(trades)
      .values(newTrades.map((t) => ({ sig: t.sig, ageS: t.ageS, wallet: t.wallet, side: t.side, sol: t.sol, tokens: t.tokens, isTreasury: t.wallet === treasuryPk })))
      .onConflictDoNothing();
  }
  if (snap) {
    await db.insert(marketSnapshots).values({
      ageS: age,
      price: snap.priceUsd,
      mcap: snap.mcapUsd,
      liq: snap.liquidityUsd,
      vol5m: snap.vol5mUsd,
      vol1h: snap.vol1hUsd,
      holders: lastHolders?.count ?? null,
      top10Pct: lastHolders?.top10 ?? null,
      treasurySol: treasury,
      migrated: snap.migrated,
    });
  }
  markDirty();
}

/** Poll every 10 baby-seconds (≥1s real). */
export function startMarketPoller() {
  if (timer) return;
  const loop = async () => {
    try {
      await pollMarket();
    } catch (e) {
      console.error("[market] poll failed", e instanceof Error ? e.message : e);
    }
    timer = setTimeout(loop, Math.max(1000, realMs(10)));
  };
  timer = setTimeout(loop, 500);
}

export async function latestSnapshot() {
  const [s] = await db.select().from(marketSnapshots).orderBy(desc(marketSnapshots.id)).limit(1);
  return s ?? null;
}

async function snapshotAt(age: number) {
  const [s] = await db.select().from(marketSnapshots).where(lte(marketSnapshots.ageS, age)).orderBy(desc(marketSnapshots.ageS)).limit(1);
  return s ?? null;
}

/** READ_TRADES */
export async function tradesView(windowS = 600) {
  requireCap("READ_TRADES");
  const age = ageS() ?? 0;
  const rows = await db.select().from(trades).where(and(gte(trades.ageS, age - windowS), eq(trades.isTreasury, false))).orderBy(desc(trades.ageS));
  const sells = rows.filter((t) => t.side === "sell").sort((a, b) => b.sol - a.sol);
  const buys = rows.filter((t) => t.side === "buy").sort((a, b) => b.sol - a.sol);
  return { window_s: windowS, count: rows.length, largestSell: sells[0] ?? null, largestBuy: buys[0] ?? null, sells: sells.length, buys: buys.length, recent: rows.slice(0, 15) };
}

export async function largestBuyerSinceLaunch() {
  requireCap("READ_TRADES");
  const r = await db.execute<{ wallet: string; sol: number; n: number; first: number }>(sql`
    select wallet, sum(sol)::float as sol, count(*)::int as n, min(age_s)::int as first
    from trades where side = 'buy' and is_treasury = false group by wallet order by sol desc limit 3`);
  return r.rows;
}

/** ANALYZE_MARKET: derived metrics (spec §3a T+18). */
export async function computeMetrics() {
  requireCap("ANALYZE_MARKET");
  const age = ageS() ?? 0;
  const sumWhere = async (from: number, to: number) => {
    const r = await db.execute<{ side: string; sol: number; n: number }>(sql`
      select side, coalesce(sum(sol),0)::float as sol, count(*)::int as n from trades
      where age_s > ${from} and age_s <= ${to} and is_treasury = false group by side`);
    const buy = r.rows.find((x) => x.side === "buy");
    const sell = r.rows.find((x) => x.side === "sell");
    return { buy: buy?.sol ?? 0, sell: sell?.sol ?? 0, nBuy: buy?.n ?? 0, nSell: sell?.n ?? 0 };
  };
  const cur = await sumWhere(age - 300, age);
  const prev = await sumWhere(age - 600, age - 300);
  const sellers = await db.execute<{ wallet: string; sol: number }>(sql`
    select wallet, sum(sol)::float as sol from trades where side='sell' and age_s > ${age - 900} and is_treasury = false
    group by wallet order by sol desc limit 1`);
  const sell15 = await sumWhere(age - 900, age);
  const now = await latestSnapshot();
  const then = await snapshotAt(age - 600);
  const p5 = await snapshotAt(age - 300);
  const vol = cur.buy + cur.sell;
  const volPrev = prev.buy + prev.sell;
  const pct = (a: number | null | undefined, b: number | null | undefined) => (a && b ? Math.round(((a - b) / b) * 1000) / 10 : null);
  return {
    volume_5m_sol: round(vol),
    volume_prev_5m_sol: round(volPrev),
    volume_delta_pct: volPrev > 0 ? Math.round(((vol - volPrev) / volPrev) * 1000) / 10 : null,
    buy_sell_ratio_5m: cur.sell > 0 ? round(cur.buy / cur.sell) : cur.buy > 0 ? null : 0,
    buys_5m: cur.nBuy,
    sells_5m: cur.nSell,
    top_wallet_sell_share_15m: sell15.sell > 0 && sellers.rows[0] ? Math.round((sellers.rows[0].sol / sell15.sell) * 1000) / 10 : 0,
    price_change_5m_pct: pct(now?.price, p5?.price),
    price_change_10m_pct: pct(now?.price, then?.price),
    holders_now: now?.holders ?? null,
    holders_delta_10m: now?.holders != null && then?.holders != null ? now.holders - then.holders : null,
    top10_pct_now: now?.top10Pct != null ? round(now.top10Pct) : null,
    concentration_delta_10m_pct_points: now?.top10Pct != null && then?.top10Pct != null ? round(now.top10Pct - then.top10Pct) : null,
    mcap_usd: now?.mcap ? Math.round(now.mcap) : null,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
