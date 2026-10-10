import { PublicKey } from "@solana/web3.js";
import WebSocket from "ws";
import { env } from "../../../env";
import { getSettings } from "../../settings";
import { ageS } from "../../clock";
import type { MarketAdapter, MarketSnapshot, Trade } from "../types";
import { connection, fetchJson } from "./rpc";
import { liveChain } from "./chain";

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL = "So11111111111111111111111111111111111111112";

const mint = () => getSettings().tokenMint;

export function bondingCurvePda(m: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(m).toBuffer()], PUMP_PROGRAM)[0];
}

export interface CurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

/** pump.fun bonding curve account: 8-byte discriminator, 5×u64, bool complete. */
export function decodeCurve(data: Buffer): CurveState {
  let o = 8;
  const u64 = () => {
    const v = data.readBigUInt64LE(o);
    o += 8;
    return v;
  };
  return {
    virtualTokenReserves: u64(),
    virtualSolReserves: u64(),
    realTokenReserves: u64(),
    realSolReserves: u64(),
    tokenTotalSupply: u64(),
    complete: data.readUInt8(o) === 1,
  };
}

export async function readCurve(m: string): Promise<CurveState | null> {
  const acc = await connection().getAccountInfo(bondingCurvePda(m));
  if (!acc || acc.data.length < 49) return null;
  return decodeCurve(acc.data);
}

interface DexPair {
  pairAddress: string;
  dexId: string;
  baseToken: { address: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { m5?: number; h1?: number };
  marketCap?: number;
  fdv?: number;
}

let pairAddrs = new Set<string>();
/** Owners that are pools/curves, not people — excluded from holder stats. */
export function excludedHolderOwners(): Set<string> {
  const s = new Set(pairAddrs);
  const m = mint();
  if (m) s.add(bondingCurvePda(m).toBase58());
  return s;
}

let solUsd: { at: number; v: number } | null = null;
async function solPriceUsd(): Promise<number | null> {
  if (solUsd && Date.now() - solUsd.at < 60_000) return solUsd.v;
  const pairs = await fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${WSOL}`).catch(() => [] as DexPair[]);
  const best = pairs.filter((p) => p.baseToken.address === WSOL && p.priceUsd).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!best?.priceUsd) return solUsd?.v ?? null;
  solUsd = { at: Date.now(), v: Number(best.priceUsd) };
  return solUsd.v;
}

// ── PumpPortal data websocket: real-time trades for the mint ──
let ws: WebSocket | null = null;
let wsMint: string | null = null;
let backoff = 1000;
let buffer: Trade[] = [];
let stopped = false;

function connectWs() {
  const m = mint();
  if (!m || stopped) return;
  const url = `wss://pumpportal.fun/api/data${env.PUMPPORTAL_API_KEY ? `?api-key=${env.PUMPPORTAL_API_KEY}` : ""}`;
  wsMint = m;
  const sock = new WebSocket(url);
  ws = sock;
  sock.on("open", () => {
    backoff = 1000;
    sock.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [m] }));
    console.log(`[pumpportal] subscribed to trades for ${m}`);
  });
  sock.on("message", (raw) => {
    try {
      const d = JSON.parse(String(raw));
      if (!d.signature || (d.txType !== "buy" && d.txType !== "sell") || d.mint !== wsMint) return;
      buffer.push({ sig: d.signature, ageS: ageS() ?? 0, wallet: d.traderPublicKey, side: d.txType, sol: Number(d.solAmount) || 0, tokens: Number(d.tokenAmount) || 0 });
      if (buffer.length > 5000) buffer = buffer.slice(-5000);
    } catch {
      /* non-trade message */
    }
  });
  const retry = () => {
    if (ws !== sock || stopped) return;
    ws = null;
    setTimeout(connectWs, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
  sock.on("close", retry);
  sock.on("error", (e) => {
    console.error("[pumpportal] ws error", e.message);
    sock.close();
  });
}

export const liveMarket: MarketAdapter = {
  async start() {
    stopped = false;
    connectWs();
  },
  async stop() {
    stopped = true;
    ws?.close();
  },

  async getSnapshot(): Promise<MarketSnapshot | null> {
    const m = mint();
    if (!m) return null;
    if (wsMint !== m) {
      // mint changed via admin → resubscribe
      ws?.close();
      ws = null;
      connectWs();
    }
    const [curve, pairs, sol, info] = await Promise.all([
      readCurve(m).catch(() => null),
      fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${m}`).catch(() => [] as DexPair[]),
      solPriceUsd(),
      liveChain.getTokenInfo().catch(() => null),
    ]);
    pairAddrs = new Set(pairs.map((p) => p.pairAddress));
    const ammPair = pairs.filter((p) => p.dexId !== "pumpfun").sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const anyPair = ammPair ?? pairs[0];
    const migrated = !!curve?.complete || !!ammPair;
    const supply = info?.supply ?? (curve ? Number(curve.tokenTotalSupply) / 1e6 : null);

    if (!migrated && curve && curve.virtualTokenReserves > 0n) {
      const priceSol = Number(curve.virtualSolReserves) / 1e9 / (Number(curve.virtualTokenReserves) / 1e6);
      const priceUsd = sol ? priceSol * sol : anyPair?.priceUsd ? Number(anyPair.priceUsd) : null;
      const realSol = Number(curve.realSolReserves) / 1e9;
      return {
        priceSol,
        priceUsd,
        mcapUsd: priceUsd && supply ? priceUsd * supply : (anyPair?.marketCap ?? null),
        liquidityUsd: sol ? realSol * sol * 2 : (anyPair?.liquidity?.usd ?? null),
        vol5mUsd: anyPair?.volume?.m5 ?? null,
        vol1hUsd: anyPair?.volume?.h1 ?? null,
        migrated: false,
        bondingCurveProgress: Math.min(1, 1 - Number(curve.realTokenReserves) / 793_100_000e6),
      };
    }
    if (!anyPair) return null;
    return {
      priceSol: anyPair.priceNative ? Number(anyPair.priceNative) : null,
      priceUsd: anyPair.priceUsd ? Number(anyPair.priceUsd) : null,
      mcapUsd: anyPair.marketCap ?? anyPair.fdv ?? null,
      liquidityUsd: anyPair.liquidity?.usd ?? null,
      vol5mUsd: anyPair.volume?.m5 ?? null,
      vol1hUsd: anyPair.volume?.h1 ?? null,
      migrated,
      bondingCurveProgress: migrated ? 1 : null,
    };
  },

  async drainTrades() {
    const out = buffer;
    buffer = [];
    return out;
  },
};

/** Executor helper: is the token still on the pump.fun bonding curve? */
export async function isMigrated(m: string): Promise<boolean> {
  const curve = await readCurve(m).catch(() => null);
  if (curve) return curve.complete;
  // no curve account readable: assume migrated only if an AMM pair exists
  const pairs = await fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${m}`).catch(() => [] as DexPair[]);
  return pairs.some((p) => p.dexId !== "pumpfun");
}
