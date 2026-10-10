import { getAdapters } from "./adapters";
import { requireCap } from "./capabilities";
import { latestSnapshot } from "./market";

export const short = (addr: string) => (addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);

/** READ_TOKEN: what Baby sees about itself. */
export async function tokenView() {
  requireCap("READ_TOKEN");
  const { chain } = getAdapters();
  const [info, treasury] = await Promise.all([chain.getTokenInfo(), chain.getTreasurySol()]);
  const snap = await latestSnapshot();
  return {
    mint: info?.mint ?? null,
    name: info?.name ?? null,
    symbol: info?.symbol ?? null,
    supply: info?.supply ?? null,
    price_usd: snap?.price ?? null,
    mcap_usd: snap?.mcap ? Math.round(snap.mcap) : null,
    liquidity_usd: snap?.liq ? Math.round(snap.liq) : null,
    treasury_sol: treasury !== null ? Math.round(treasury * 1000) / 1000 : null,
    on_bonding_curve: snap ? !snap.migrated : null,
  };
}

/** READ_HOLDERS */
export async function holdersView(limit = 10) {
  requireCap("READ_HOLDERS");
  const h = await getAdapters().chain.getHolders(Math.max(limit, 10));
  if (!h) return null;
  const top10 = h.top.slice(0, 10).reduce((a, x) => a + x.pct, 0);
  return {
    holder_count: h.count,
    top10_pct: Math.round(top10 * 100) / 100,
    top: h.top.slice(0, limit).map((x) => ({ wallet: short(x.owner), pct: Math.round(x.pct * 100) / 100 })),
    fullTop: h.top,
  };
}

export async function treasurySol(): Promise<number | null> {
  return getAdapters().chain.getTreasurySol();
}
