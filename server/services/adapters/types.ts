/** Adapter contracts. Sim and live implementations are interchangeable. */

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  supply: number; // UI units
  decimals: number;
}

export interface MarketSnapshot {
  priceUsd: number | null;
  priceSol: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  vol5mUsd: number | null;
  vol1hUsd: number | null;
  /** true once the token has left the pump.fun bonding curve */
  migrated: boolean;
  bondingCurveProgress: number | null; // 0–1
}

export interface Holder {
  owner: string;
  amount: number; // UI units
  pct: number; // 0–100 of supply
}

export interface Trade {
  sig: string;
  ageS: number;
  wallet: string;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
}

export interface Mention {
  id: string;
  ageS: number;
  handle: string;
  text: string;
  followers: number;
  likes: number;
  replies: number;
  /** flagged as likely posted by a minor — never reply */
  minorFlag: boolean;
}

export interface PostResult {
  id: string;
  url: string;
}

export interface ChainAdapter {
  treasuryAddress(): string | null;
  getTokenInfo(): Promise<TokenInfo | null>;
  getTreasurySol(): Promise<number | null>;
  getHolders(limit?: number): Promise<{ count: number; top: Holder[] } | null>;
}

export interface MarketAdapter {
  getSnapshot(): Promise<MarketSnapshot | null>;
  /** trades seen since the last call (adapter tracks its own cursor) */
  drainTrades(): Promise<Trade[]>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface SocialAdapter {
  readonly simulated: boolean;
  /** maxResults is bounded by the remaining daily X budget (X allows 5–100) */
  fetchMentions(sinceId: string | null, maxResults: number): Promise<Mention[]>;
  post(text: string): Promise<PostResult>;
  reply(inReplyToId: string, text: string): Promise<PostResult>;
}

export interface SwapResult {
  sig: string;
  proofUrl: string;
  tokensOut: number | null;
}

export interface ExecutorAdapter {
  readonly simulated: boolean;
  buyback(amountSol: number, slippageBps: number): Promise<SwapResult>;
}
