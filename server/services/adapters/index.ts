import { isSim } from "../../env";
import type { ChainAdapter, ExecutorAdapter, MarketAdapter, SocialAdapter } from "./types";
import { simChain, simExecutor, simMarket, simSocial } from "./sim";

export interface Adapters {
  chain: ChainAdapter;
  market: MarketAdapter;
  social: SocialAdapter;
  executor: ExecutorAdapter;
}

let adapters: Adapters | null = null;

export async function initAdapters(): Promise<Adapters> {
  if (adapters) return adapters;
  if (isSim) {
    adapters = { chain: simChain, market: simMarket, social: simSocial, executor: simExecutor };
  } else {
    const [{ liveChain }, { liveMarket }, { liveX }, { liveExecutor }] = await Promise.all([
      import("./live/chain"),
      import("./live/market"),
      import("./live/x"),
      import("./live/executor"),
    ]);
    adapters = { chain: liveChain, market: liveMarket, social: liveX, executor: liveExecutor };
    await liveMarket.start?.();
  }
  return adapters;
}

export function getAdapters(): Adapters {
  if (!adapters) throw new Error("adapters not initialised");
  return adapters;
}
