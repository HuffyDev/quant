import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { env } from "../../../env";
import { getSettings } from "../../settings";
import type { ChainAdapter, Holder, TokenInfo } from "../types";
import { connection, rpc } from "./rpc";
import { excludedHolderOwners } from "./market";

const mint = () => getSettings().tokenMint;

let infoCache: { mint: string; info: TokenInfo } | null = null;
let holdersCache: { at: number; value: { count: number; top: Holder[] } } | null = null;

interface DasAsset {
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: { supply?: number; decimals?: number; symbol?: string };
}
interface DasTokenAccounts {
  total?: number;
  token_accounts: { owner: string; amount: number | string }[];
}

/** Helius: token supply, treasury SOL, holders (DAS getTokenAccounts by mint). */
export const liveChain: ChainAdapter = {
  treasuryAddress() {
    return env.TREASURY_PUBKEY ?? null;
  },

  async getTokenInfo() {
    const m = mint();
    if (!m) return null;
    if (infoCache?.mint === m) return infoCache.info;
    const a = await rpc<DasAsset>("getAsset", { id: m });
    const decimals = a.token_info?.decimals ?? 6;
    const supply = await connection().getTokenSupply(new PublicKey(m));
    const info: TokenInfo = {
      mint: m,
      name: a.content?.metadata?.name ?? getSettings().tokenName ?? "unknown",
      symbol: a.content?.metadata?.symbol ?? a.token_info?.symbol ?? getSettings().tokenSymbol ?? "?",
      supply: Number(supply.value.uiAmount ?? 0),
      decimals,
    };
    infoCache = { mint: m, info };
    return info;
  },

  async getTreasurySol() {
    if (!env.TREASURY_PUBKEY) return null;
    const lamports = await connection().getBalance(new PublicKey(env.TREASURY_PUBKEY));
    return lamports / LAMPORTS_PER_SOL;
  },

  /** Paginates DAS getTokenAccounts (cached 60s; capped at 25k accounts). Pools/bonding curve excluded. */
  async getHolders(limit = 20) {
    const m = mint();
    if (!m) return null;
    if (holdersCache && Date.now() - holdersCache.at < 60_000) return { count: holdersCache.value.count, top: holdersCache.value.top.slice(0, limit) };
    const info = await this.getTokenInfo();
    const decimals = info?.decimals ?? 6;
    const supply = info?.supply || 1;
    const byOwner = new Map<string, number>();
    for (let page = 1; page <= 25; page++) {
      const r = await rpc<DasTokenAccounts>("getTokenAccounts", { mint: m, page, limit: 1000, options: { showZeroBalance: false } });
      for (const a of r.token_accounts ?? []) {
        const amt = Number(a.amount) / 10 ** decimals;
        if (amt > 0) byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0) + amt);
      }
      if (!r.token_accounts || r.token_accounts.length < 1000) break;
    }
    const excluded = excludedHolderOwners();
    const list = [...byOwner.entries()]
      .filter(([owner]) => !excluded.has(owner))
      .map(([owner, amount]) => ({ owner, amount, pct: (amount / supply) * 100 }))
      .sort((a, b) => b.amount - a.amount);
    holdersCache = { at: Date.now(), value: { count: list.length, top: list.slice(0, 50) } };
    return { count: list.length, top: list.slice(0, limit) };
  },
};
