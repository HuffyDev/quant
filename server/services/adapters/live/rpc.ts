import { Connection } from "@solana/web3.js";
import { env } from "../../../env";

export function rpcUrl(): string {
  if (env.HELIUS_RPC_URL) return env.HELIUS_RPC_URL;
  if (env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  throw new Error("HELIUS_RPC_URL or HELIUS_API_KEY is required in MODE=live");
}

let conn: Connection | null = null;
export function connection(): Connection {
  return (conn ??= new Connection(rpcUrl(), { commitment: "confirmed" }));
}

/** Raw JSON-RPC call (used for Helius DAS methods not in web3.js). */
export async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetchJson<{ result?: T; error?: { message: string } }>(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "bb", method, params }),
  });
  if (res.error) throw new Error(`${method}: ${res.error.message}`);
  return res.result as T;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url.replace(/api-key=[^&]+/, "api-key=***")} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}
