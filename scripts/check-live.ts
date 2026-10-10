/**
 * npm run check:live — read-only smoke test of every real API Baby Brain uses.
 * Never posts, never signs, never writes to the database.
 *
 * Costs: one tiny Anthropic call (~$0.0001) and one X mentions read (≤5 posts at X_COST_READ_USD).
 */
import "dotenv/config";

// This script needs no database, but the shared env loader requires a value. MODE/LLM_PROVIDER are forced only so the
// loader can't exit early on a missing key; the Anthropic check below calls the SDK directly with ANTHROPIC_API_KEY.
process.env.DATABASE_URL ||= "postgres://unused@127.0.0.1:1/unused";
process.env.MODE = "sim";
process.env.LLM_PROVIDER = "mock";

type Result = { status: "PASS" | "FAIL" | "SKIP" | "WARN"; detail: string; ms: number };
class Skip extends Error {}
class Warn extends Error {}

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // used only when TOKEN_MINT is unset
const env = process.env;

const results: [string, Result][] = [];

async function check(name: string, fn: () => Promise<string>, timeoutMs = 15_000) {
  const t0 = Date.now();
  let r: Result;
  try {
    const detail = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs / 1000}s`)), timeoutMs))]);
    r = { status: "PASS", detail, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r = { status: e instanceof Skip ? "SKIP" : e instanceof Warn ? "WARN" : "FAIL", detail: msg.replace(/api-key=[^&\s]+/g, "api-key=***").slice(0, 300), ms: Date.now() - t0 };
  }
  results.push([name, r]);
  const color = { PASS: "\x1b[32m", FAIL: "\x1b[31m", SKIP: "\x1b[90m", WARN: "\x1b[33m" }[r.status];
  console.log(`${color}${r.status.padEnd(4)}\x1b[0m  ${name.padEnd(30)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
}

const need = (...keys: string[]) => {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Skip(`not set: ${missing.join(", ")}`);
};

async function main() {
  console.log("Baby Brain — live API check (read-only)\n");
  const mint = env.TOKEN_MINT || null;
  const { fetchJson, rpc, connection } = await import("../server/services/adapters/live/rpc");

  // ── Anthropic ──
  await check("Anthropic: models", async () => {
    need("ANTHROPIC_API_KEY");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const main = env.LLM_MODEL_MAIN || "claude-sonnet-5-5";
    const cheap = env.LLM_MODEL_CHEAP || "claude-haiku-5-5";
    const [a, b] = await Promise.all([client.models.retrieve(main), client.models.retrieve(cheap)]);
    const msg = await client.messages.create({ model: cheap, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ok" }] });
    const text = msg.content.find((c) => c.type === "text");
    return `${a.id} + ${b.id} available · test reply "${text && "text" in text ? text.text.trim() : "?"}"`;
  });

  // ── Helius ──
  await check("Helius: RPC", async () => {
    if (!env.HELIUS_RPC_URL) need("HELIUS_API_KEY");
    const [health, slot] = await Promise.all([rpc<string>("getHealth", []), connection().getSlot()]);
    return `getHealth=${health} · slot ${slot}`;
  });

  await check("Helius: holders (DAS)", async () => {
    if (!env.HELIUS_RPC_URL) need("HELIUS_API_KEY");
    const m = mint ?? USDC;
    const [asset, accts] = await Promise.all([
      rpc<{ content?: { metadata?: { name?: string; symbol?: string } } }>("getAsset", { id: m }),
      rpc<{ total?: number; token_accounts: { owner: string; amount: number }[] }>("getTokenAccounts", { mint: m, page: 1, limit: 10, options: { showZeroBalance: false } }),
    ]);
    const label = `${asset.content?.metadata?.symbol ?? "?"} (${asset.content?.metadata?.name ?? "?"})`;
    const res = `${label} · getTokenAccounts returned ${accts.token_accounts.length} accounts on page 1`;
    if (!mint) throw new Warn(`TOKEN_MINT not set — tested DAS against USDC: ${res}`);
    return res;
  });

  await check("pump.fun bonding curve", async () => {
    if (!mint) throw new Skip("TOKEN_MINT not set");
    if (!env.HELIUS_RPC_URL) need("HELIUS_API_KEY");
    const { readCurve } = await import("../server/services/adapters/live/market");
    const c = await readCurve(mint);
    if (!c) throw new Warn("no bonding-curve account for this mint (not a pump.fun token, or already closed)");
    const priceSol = Number(c.virtualSolReserves) / 1e9 / (Number(c.virtualTokenReserves) / 1e6);
    return `complete=${c.complete} · price ${priceSol.toExponential(3)} SOL · real SOL ${(Number(c.realSolReserves) / 1e9).toFixed(3)}`;
  });

  // ── DexScreener ──
  await check("DexScreener", async () => {
    const m = mint ?? WSOL;
    const pairs = await fetchJson<{ dexId: string; priceUsd?: string; liquidity?: { usd?: number } }[]>(`https://api.dexscreener.com/tokens/v1/solana/${m}`);
    if (!pairs.length) throw new Warn(`no pairs indexed yet for ${mint ? "TOKEN_MINT" : "wSOL"} (normal for a brand-new token)`);
    const top = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return `${pairs.length} pair(s) for ${mint ? "TOKEN_MINT" : "wSOL"} · top ${top.dexId} $${top.priceUsd}`;
  });

  // ── PumpPortal ──
  await check("PumpPortal websocket", async () => {
    const { default: WebSocket } = await import("ws");
    const url = `wss://pumpportal.fun/api/data${env.PUMPPORTAL_API_KEY ? `?api-key=${env.PUMPPORTAL_API_KEY}` : ""}`;
    return await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(url);
      let opened = false;
      const done = (fn: () => void) => {
        clearTimeout(t);
        ws.close();
        fn();
      };
      const t = setTimeout(() => done(() => (opened ? resolve("connected + subscribed (no ack within 8s)") : reject(new Error("could not connect within 8s")))), 8000);
      ws.on("open", () => {
        opened = true;
        ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint ?? WSOL] }));
      });
      ws.on("message", (raw) => done(() => resolve(`connected + subscribed · first message: ${String(raw).slice(0, 90)}`)));
      ws.on("error", (e) => done(() => reject(e)));
    });
  }, 12_000);

  // ── X ──
  let xId: string | null = null;
  await check("X: /2/users/me (OAuth 1.0a)", async () => {
    need("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET");
    const { TwitterApi } = await import("twitter-api-v2");
    const c = new TwitterApi({ appKey: env.X_API_KEY!, appSecret: env.X_API_SECRET!, accessToken: env.X_ACCESS_TOKEN!, accessSecret: env.X_ACCESS_SECRET! });
    const u = await c.v2.me();
    xId = u.data.id;
    const res = `@${u.data.username} · id ${u.data.id}`;
    if (env.X_BOT_USER_ID && env.X_BOT_USER_ID !== u.data.id) throw new Warn(`${res} — differs from X_BOT_USER_ID=${env.X_BOT_USER_ID} (app will use ${u.data.id})`);
    if (env.X_BOT_HANDLE && env.X_BOT_HANDLE.replace(/^@/, "").toLowerCase() !== u.data.username.toLowerCase()) throw new Warn(`${res} — differs from X_BOT_HANDLE=${env.X_BOT_HANDLE}`);
    return res;
  });

  await check("X: mentions timeline", async () => {
    const id = xId ?? env.X_BOT_USER_ID;
    if (!id) throw new Skip("no bot user id (users/me failed and X_BOT_USER_ID unset)");
    const { TwitterApi } = await import("twitter-api-v2");
    const reader = env.X_BEARER_TOKEN
      ? new TwitterApi(env.X_BEARER_TOKEN).readOnly
      : (need("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"),
        new TwitterApi({ appKey: env.X_API_KEY!, appSecret: env.X_API_SECRET!, accessToken: env.X_ACCESS_TOKEN!, accessSecret: env.X_ACCESS_SECRET! }).readOnly);
    const r = await reader.v2.userMentionTimeline(id, { max_results: 5 });
    return `${r.tweets?.length ?? 0} recent mention(s) · auth ${env.X_BEARER_TOKEN ? "bearer" : "OAuth 1.0a"}`;
  });

  // ── Jupiter ──
  await check("Jupiter: quote (no tx)", async () => {
    need("JUPITER_API_KEY");
    const out = mint ?? USDC;
    const q = new URLSearchParams({ inputMint: WSOL, outputMint: out, amount: String(10_000_000) }); // 0.01 SOL, no taker → quote only
    const r = await fetchJson<{ outAmount?: string; router?: string; requestId?: string; errorMessage?: string; error?: string }>(`https://api.jup.ag/swap/v2/order?${q}`, {
      headers: { "x-api-key": env.JUPITER_API_KEY! },
    });
    if (!r.outAmount) throw new Error(`no quote: ${r.errorMessage ?? r.error ?? JSON.stringify(r).slice(0, 150)}`);
    const res = `0.01 SOL → ${r.outAmount} base units of ${mint ? "TOKEN_MINT" : "USDC"}${r.router ? ` via ${r.router}` : ""}`;
    if (!mint) throw new Warn(`TOKEN_MINT not set — quoted USDC: ${res}`);
    return res;
  });

  // ── Treasury ──
  await check("Treasury balance", async () => {
    need("TREASURY_PUBKEY");
    if (!env.HELIUS_RPC_URL) need("HELIUS_API_KEY");
    const { PublicKey } = await import("@solana/web3.js");
    const lamports = await connection().getBalance(new PublicKey(env.TREASURY_PUBKEY!));
    const sol = lamports / 1e9;
    const reserve = Number(env.MIN_TREASURY_RESERVE_SOL || 3);
    const res = `${sol.toFixed(4)} SOL (reserve ${reserve})`;
    if (sol <= reserve) throw new Warn(`${res} — at or below reserve, the Guardian will reject every buyback`);
    return res;
  });

  await check("Treasury key matches pubkey", async () => {
    need("TREASURY_PUBKEY", "TREASURY_PRIVATE_KEY");
    const { verifyTreasuryKey } = await import("../server/services/adapters/live/executor");
    const r = verifyTreasuryKey();
    if (!r.ok) throw new Error(r.detail);
    return r.detail; // decode + compare only; nothing is signed
  });

  const count = (s: Result["status"]) => results.filter(([, r]) => r.status === s).length;
  console.log(`\n${count("PASS")} PASS · ${count("WARN")} WARN · ${count("FAIL")} FAIL · ${count("SKIP")} SKIP`);
  process.exit(count("FAIL") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
