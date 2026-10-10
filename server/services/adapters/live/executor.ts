import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { env } from "../../../env";
import { getSettings } from "../../settings";
import { assertDebitWithin, assertProgramsAllowed, assertTreasurySigner } from "../../txCheck";
import type { ExecutorAdapter, SwapResult } from "../types";
import { connection, fetchJson } from "./rpc";
import { isMigrated } from "./market";

/**
 * LIVE EXECUTOR. The only file in the codebase that reads TREASURY_PRIVATE_KEY.
 * Pre-migration: PumpPortal Local Transaction API → checks → sign locally → send via Helius.
 * Post-migration: Jupiter Swap API v2 (/order → checks → sign → /execute); falls back to PumpPortal pool "pump-amm"
 * if Jupiter's route touches a non-whitelisted program.
 */

const WSOL = "So11111111111111111111111111111111111111112";
const JUP = "https://api.jup.ag/swap/v2";

let kp: Keypair | null = null;
function treasuryKeypair(): Keypair {
  if (kp) return kp;
  const raw = process.env.TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error("TREASURY_PRIVATE_KEY not set");
  const k = Keypair.fromSecretKey(bs58.decode(raw.trim()));
  if (!env.TREASURY_PUBKEY || k.publicKey.toBase58() !== env.TREASURY_PUBKEY) throw new Error("TREASURY_PRIVATE_KEY does not match TREASURY_PUBKEY");
  kp = k;
  return k;
}

/** Read-only check used by `npm run check:live`: does the private key decode and match TREASURY_PUBKEY? Never signs. */
export function verifyTreasuryKey(): { ok: boolean; detail: string } {
  try {
    const k = treasuryKeypair();
    return { ok: true, detail: `private key matches ${k.publicKey.toBase58()}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function preflight(tx: VersionedTransaction, amountSol: number) {
  const treasury = env.TREASURY_PUBKEY!;
  const programs = assertProgramsAllowed(tx);
  assertTreasurySigner(tx, treasury);
  const conn = connection();
  const pre = await conn.getBalance(new PublicKey(treasury));
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, accounts: { encoding: "base64", addresses: [treasury] } });
  if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-3).join(" | ")}`);
  const post = sim.value.accounts?.[0]?.lamports;
  if (post == null) throw new Error("simulation did not return treasury balance");
  const debit = assertDebitWithin(pre, post, amountSol);
  console.log(`[executor] preflight ok · programs ${programs.join(",")} · simulated debit ${debit.toFixed(4)} SOL`);
}

async function confirm(sig: string, timeoutMs = 60_000) {
  const conn = connection();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false });
    const s = value[0];
    if (s?.err) throw new Error(`transaction failed on chain: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`transaction ${sig} not confirmed within ${timeoutMs / 1000}s`);
}

async function tokensReceived(sig: string, mint: string): Promise<number | null> {
  try {
    const tx = await connection().getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    const owner = env.TREASURY_PUBKEY;
    type Bal = { mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } };
    const bal = (arr: Bal[] | null | undefined) => (arr ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((a, b) => a + Number(b.uiTokenAmount.uiAmount ?? 0), 0);
    return tx?.meta ? bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances) : null;
  } catch {
    return null;
  }
}

async function viaPumpPortal(mint: string, amountSol: number, slippageBps: number, pool: "pump" | "pump-amm"): Promise<string> {
  const k = treasuryKeypair();
  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      publicKey: k.publicKey.toBase58(),
      action: "buy",
      mint,
      amount: amountSol,
      denominatedInSol: "true",
      slippage: slippageBps / 100, // percent
      priorityFee: 0.0005,
      pool,
    }),
  });
  if (res.status !== 200) throw new Error(`pumpportal trade-local ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  await preflight(tx, amountSol);
  tx.sign([k]);
  const sig = await connection().sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirm(sig);
  return sig;
}

interface JupOrder {
  transaction?: string | null;
  requestId: string;
  outAmount?: string;
  errorMessage?: string;
  error?: string;
}
interface JupExecute {
  status: "Success" | "Failed" | string;
  signature?: string;
  error?: string;
  code?: number;
}

async function viaJupiter(mint: string, amountSol: number, slippageBps: number): Promise<string> {
  if (!env.JUPITER_API_KEY) throw new Error("JUPITER_API_KEY not set (required after migration)");
  const k = treasuryKeypair();
  const lamports = Math.floor(amountSol * 1e9);
  const q = new URLSearchParams({ inputMint: WSOL, outputMint: mint, amount: String(lamports), taker: k.publicKey.toBase58(), slippageBps: String(slippageBps) });
  const headers = { "x-api-key": env.JUPITER_API_KEY };
  const order = await fetchJson<JupOrder>(`${JUP}/order?${q}`, { headers });
  if (!order.transaction) throw new Error(`jupiter order returned no transaction: ${order.errorMessage ?? order.error ?? "unknown"}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  await preflight(tx, amountSol);
  tx.sign([k]); // partial sign: a JupiterZ market maker may co-sign
  const ex = await fetchJson<JupExecute>(`${JUP}/execute`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction: Buffer.from(tx.serialize()).toString("base64"), requestId: order.requestId }),
  }, 70_000);
  if (ex.status !== "Success" || !ex.signature) throw new Error(`jupiter execute ${ex.status}: ${ex.error ?? ex.code ?? ""}`);
  return ex.signature;
}

export const liveExecutor: ExecutorAdapter = {
  simulated: false,
  async buyback(amountSol, slippageBps): Promise<SwapResult> {
    const mint = getSettings().tokenMint;
    if (!mint) throw new Error("TOKEN_MINT not set");
    let sig: string;
    if (!(await isMigrated(mint))) {
      sig = await viaPumpPortal(mint, amountSol, slippageBps, "pump");
    } else {
      try {
        sig = await viaJupiter(mint, amountSol, slippageBps);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/non-whitelisted/.test(msg)) throw e;
        console.warn(`[executor] jupiter route refused (${msg}); falling back to PumpSwap via PumpPortal`);
        sig = await viaPumpPortal(mint, amountSol, slippageBps, "pump-amm");
      }
    }
    return { sig, proofUrl: `https://solscan.io/tx/${sig}`, tokensOut: await tokensReceived(sig, mint) };
  },
};
