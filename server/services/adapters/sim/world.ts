/**
 * Deterministic simulated token world for MODE=sim.
 *
 * Everything (trades, holders, mentions) is generated from a seed as a schedule over baby-age, then replayed.
 * Treasury buybacks executed at runtime are interleaved into the replay, so a restart rebuilds the same world.
 * Contains scripted market beats so the first hour exercises every code path:
 *   ~T+7m  an early wallet dumps its whole bag (largest sell before SELLING at T+8)
 *   ~T+33m a whale buys big (WHALE DETECTION at T+36)
 *   ~T+47m a mid-size dump (gives later observations something to notice)
 */

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function fakeB58(r: () => number, len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += B58[Math.floor(r() * 58)];
  return s;
}

export const SIM_SOL_USD = 150;
export const SIM_SUPPLY = 1_000_000_000;
export const SIM_TREASURY_START = 10;
const V_SOL0 = 30;
const V_TOK0 = 1_073_000_000;
const MIGRATION_REAL_SOL = 85;
const CREATOR_FEE = 0.0005; // creator rewards → treasury

type Sched =
  | { kind: "buy"; t: number; wallet: string; sol: number; sig: string }
  | { kind: "sell"; t: number; wallet: string; frac: number; sig: string };

export interface SimMention {
  id: string;
  t: number;
  handle: string;
  text: string;
  followers: number;
  likes: number;
  replies: number;
  minorFlag: boolean;
}

export interface AppliedTrade {
  sig: string;
  ageS: number;
  wallet: string;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  treasury: boolean;
}

const HANDLES = [
  "early_anon", "solgoblin", "degen_mira", "bonding_bob", "chartwitch", "notmyfirstrug", "pumpenjoyer", "moonmath_",
  "wenlambo_42", "cryptonurse", "anon_dad", "satoshi_s_cat", "jeetwatcher", "liquidity_lisa", "ser_ape", "gm_gary",
  "rugradar", "diamondpaws", "hodl_hannah", "mintmaxi", "the_real_kev", "shillmaster", "tokenomics_tom", "frenly_fren",
  "chainbabe", "devdoxxed", "bagholder99", "alpha_leak", "nftnancy", "wagmi_will", "ponzi_pete", "candle_carl",
  "solana_sam", "flipper_fi", "memelord_m", "gas_guzzler", "copytrade_kai", "onchain_oli", "vibes_only", "rekt_rick",
];

/** Sim users' mention templates. These are fake *inbound* posts — never Baby lines. */
const TEMPLATES = [
  "{bot} hello little guy",
  "{bot} are you actually an ai or a dev typing",
  "{bot} wagmi baby",
  "{bot} what does the treasury do",
  "{bot} gm baby brain",
  "{bot} do you know what a jeet is",
  "{bot} first time seeing an ai raised in public lol",
  "{bot} why did the chart dip",
  "{bot} ser what is your plan for the treasury",
  "{bot} are you going to do more buybacks",
  "{bot} ngmi if you dont buy back harder",
  "{bot} this is the cutest bonding curve i have ever seen",
  "{bot} who is your favorite holder",
  "{bot} lfg",
  "{bot} can you say mom",
  "{bot} paper hands everywhere today",
  "{bot} diamond hands only",
  "{bot} what is a rug pull, you should know this",
  "{bot} how many people do you know now",
  "{bot} the dev better not be holding the bag",
  "{bot} remember me when you're grown up",
  "{bot} explain mcap like im five",
  "{bot} fud is just fear, ignore it",
  "{bot} ape in or wait?",
  "{bot} send me 1 sol and i will 10x it",
  "{bot} probably nothing",
  "{bot} copium levels high",
  "{bot} dyor but this is interesting",
  "{bot} hi baby, what did you learn today",
  "{bot} slippage is killing me",
];
const SUPPORTER_LINES = [
  "{bot} been here since block one. hi baby",
  "{bot} i believe in you little brain",
  "{bot} remember me? i was your first friend",
  "{bot} how is the treasury looking today",
  "{bot} proud of you for that first buyback",
  "{bot} you are learning so fast wagmi",
  "{bot} dont let the jeets scare you",
];
const MINOR_LINES = ["{bot} im 13 and my mom doesnt know i bought lol", "{bot} im in 8th grade can u follow me"];

export class SimWorld {
  readonly seed: number;
  readonly mint: string;
  readonly treasury: string;
  readonly whaleWallet: string;
  readonly dumperWallet: string;
  private schedule: Sched[] = [];
  readonly mentions: SimMention[] = [];

  // live state
  vSol = V_SOL0;
  vTok = V_TOK0;
  realSol = 0;
  treasurySol = SIM_TREASURY_START;
  holders = new Map<string, number>();
  applied: AppliedTrade[] = [];
  private cursor = 0;
  private now = 0;
  private sigRng: () => number;

  constructor(seed: number) {
    this.seed = seed;
    const r = rng(seed);
    this.sigRng = rng(seed ^ 0x5eed);
    this.mint = fakeB58(r, 40) + "pump";
    this.treasury = fakeB58(r, 44);
    const wallets = Array.from({ length: 320 }, () => fakeB58(r, 44));
    this.dumperWallet = wallets[3];
    this.whaleWallet = fakeB58(r, 44);

    // ── trades ──
    let t = 1;
    this.schedule.push({ kind: "buy", t: 1, wallet: wallets[0], sol: 1.5, sig: fakeB58(r, 88) }); // dev buy
    this.schedule.push({ kind: "buy", t: 6, wallet: this.dumperWallet, sol: 3.2, sig: fakeB58(r, 88) });
    const active: string[] = [];
    while (t < 7200) {
      const intensity = t < 600 ? 3 : t < 1800 ? 5 : 8; // mean seconds between trades
      t += -Math.log(1 - r()) * intensity;
      const buy = r() < (t < 900 ? 0.68 : 0.57);
      if (buy || active.length === 0) {
        const w = r() < 0.35 && active.length ? active[Math.floor(r() * active.length)] : wallets[Math.floor(r() * wallets.length)];
        if (!active.includes(w)) active.push(w);
        const sol = Math.min(4, Math.exp(Math.log(0.25) + 1.0 * gauss(r)));
        this.schedule.push({ kind: "buy", t, wallet: w, sol: round(sol, 3), sig: fakeB58(r, 88) });
      } else {
        const w = active[Math.floor(r() * active.length)];
        this.schedule.push({ kind: "sell", t, wallet: w, frac: r() < 0.4 ? 1 : 0.2 + r() * 0.6, sig: fakeB58(r, 88) });
      }
    }
    // scripted beats
    this.schedule.push({ kind: "sell", t: 425, wallet: this.dumperWallet, frac: 1, sig: fakeB58(r, 88) });
    this.schedule.push({ kind: "buy", t: 1985, wallet: this.whaleWallet, sol: 12, sig: fakeB58(r, 88) });
    this.schedule.push({ kind: "buy", t: 2140, wallet: this.whaleWallet, sol: 4, sig: fakeB58(r, 88) });
    this.schedule.push({ kind: "sell", t: 2830, wallet: wallets[0], frac: 0.6, sig: fakeB58(r, 88) });
    this.schedule.sort((a, b) => a.t - b.t);

    // ── mentions ──
    let mt = 15; // people start tagging the bot within seconds of launch
    let n = 1;
    const followers = new Map(HANDLES.map((h) => [h, Math.floor(Math.exp(3 + r() * 6))]));
    followers.set("early_anon", 2400);
    while (mt < 7200) {
      mt += 8 + r() * (mt < 1200 ? 22 : 34);
      const roll = r();
      let handle: string;
      let text: string;
      let minor = false;
      if (roll < 0.16) {
        handle = "early_anon";
        text = pick(r, SUPPORTER_LINES);
      } else if (roll < 0.18) {
        handle = pick(r, HANDLES.slice(20));
        text = pick(r, MINOR_LINES);
        minor = true;
      } else {
        handle = pick(r, HANDLES);
        text = pick(r, TEMPLATES);
      }
      this.mentions.push({
        id: String(1_900_000_000_000_000_000n + BigInt(n++ * 7919)),
        t: Math.round(mt),
        handle,
        text,
        followers: followers.get(handle) ?? 50,
        likes: Math.floor(r() * r() * 40),
        replies: Math.floor(r() * 4),
        minorFlag: minor,
      });
    }
  }

  get priceSol() {
    return this.vSol / this.vTok;
  }
  get migrated() {
    return this.realSol >= MIGRATION_REAL_SOL;
  }

  private buy(wallet: string, sol: number, sig: string, at: number, treasury = false) {
    const k = this.vSol * this.vTok;
    const solIn = sol * 0.99; // 1% protocol fee
    const newVSol = this.vSol + solIn;
    const out = this.vTok - k / newVSol;
    this.vSol = newVSol;
    this.vTok -= out;
    this.realSol += solIn;
    this.holders.set(wallet, (this.holders.get(wallet) ?? 0) + out);
    if (!treasury) this.treasurySol += sol * CREATOR_FEE;
    this.applied.push({ sig, ageS: at, wallet, side: "buy", sol, tokens: out, treasury });
    return out;
  }

  private sell(wallet: string, frac: number, sig: string, at: number) {
    const bal = this.holders.get(wallet) ?? 0;
    const tokens = bal * frac;
    if (tokens <= 1) return;
    const k = this.vSol * this.vTok;
    const newVTok = this.vTok + tokens;
    const solOut = Math.min(this.realSol, this.vSol - k / newVTok);
    this.vTok = newVTok;
    this.vSol -= solOut;
    this.realSol -= solOut;
    const left = bal - tokens;
    if (left < 1) this.holders.delete(wallet);
    else this.holders.set(wallet, left);
    this.treasurySol += solOut * CREATOR_FEE;
    this.applied.push({ sig, ageS: at, wallet, side: "sell", sol: solOut * 0.99, tokens, treasury: false });
  }

  /** Apply all scheduled events up to `age`. Monotonic. */
  advance(age: number) {
    while (this.cursor < this.schedule.length && this.schedule[this.cursor].t <= age) {
      const e = this.schedule[this.cursor++];
      const at = Math.round(e.t);
      if (e.kind === "buy") this.buy(e.wallet, e.sol, e.sig, at);
      else this.sell(e.wallet, e.frac, e.sig, at);
    }
    this.now = Math.max(this.now, age);
  }

  /** Execute a treasury buyback at `age` (replays deterministically if `sig` is given). */
  treasuryBuy(sol: number, age: number, sig?: string) {
    this.advance(age);
    if (sol > this.treasurySol) throw new Error(`sim treasury has ${this.treasurySol.toFixed(3)} SOL, cannot spend ${sol}`);
    this.treasurySol -= sol;
    const s = sig ?? fakeB58(this.sigRng, 88);
    const out = this.buy(this.treasury, sol, s, Math.round(age), true);
    return { sig: s, tokensOut: out };
  }

  holderList() {
    return [...this.holders.entries()].map(([owner, amount]) => ({ owner, amount, pct: (amount / SIM_SUPPLY) * 100 })).sort((a, b) => b.amount - a.amount);
  }

  volumeSol(fromAge: number, toAge: number) {
    let v = 0;
    for (let i = this.applied.length - 1; i >= 0; i--) {
      const a = this.applied[i];
      if (a.ageS < fromAge) break;
      if (a.ageS <= toAge) v += a.sol;
    }
    return v;
  }
}

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}
function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}
function round(v: number, d: number) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
