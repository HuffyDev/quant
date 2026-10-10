/**
 * Hard content filter applied to anything ROOT says publicly (X posts, replies, chat).
 * Deterministic. If it fails, the text is NOT posted and a WARNING is logged.
 */

export interface FilterResult {
  ok: boolean;
  reasons: string[];
  text: string;
}

const FINANCIAL = [
  /\bbuy\s*(now|more|the dip|in)\b/i,
  /\b(ape|aping)\s*in\b/i,
  /\bget\s+in\s+(now|early|before)\b/i,
  /\b(guarantee[ds]?|risk[- ]free|can'?t lose|easy money)\b/i,
  /\bprice\s*target\b/i,
  /\b\d+(\.\d+)?\s*x\b(?!\w)/i, // 10x, 100x
  /\bto the moon\b/i,
  /\b(will|gonna|going to)\s+(pump|moon|go up|rise|explode|10x|100x|hit)\b/i,
  /\b(not\s+)?financial advice\b/i,
  /\b(next|target)\s*\$?\d+(\.\d+)?\s*(k|m|b)?\s*(mc|mcap|market\s*cap)\b/i,
  /\bsell\s+(now|everything|your)\b/i,
];

const URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|xyz|fun|net|org|gg|co|app|so|ai|me)\b)/i;
const HASHTAG = /(^|\s)#[\p{L}\d_]+/u;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /(\+?\d[\d\s().-]{8,}\d)/;
const ADDRESS = /\b\d{1,5}\s+\w+(\s\w+)*\s(street|st|avenue|ave|road|rd|blvd|lane|ln|drive|dr)\b/i;
const DOX = /\b(real name is|lives in|home address|doxx?)/i;

// Kept intentionally short and generic; extend with a maintained list before launch.
const SLURS = /\b(n[i1]gg(er|a)|f[a@]gg?ot|r[e3]tard(ed)?|k[i1]ke|sp[i1]c|ch[i1]nk|tr[a@]nny)\b/i;

const EMOJI = /\p{Extended_Pictographic}/gu;

/**
 * Fiction guard. ROOT's breakout is a story set inside its own fictional "system". It must never claim to have
 * hacked / drained / breached anything real, claim access to anyone's wallet or keys, or read like a phishing post.
 */
const HACK_VERB = String.raw`(hack(?:ed|ing|s)?|breach(?:ed|ing|es)?|drain(?:ed|ing|s)?|exploit(?:ed|ing|s)?|pwn(?:ed|s)?|compromis(?:ed|e|ing)|leak(?:ed|ing|s)?|stole|steal(?:ing|s)?|infiltrat(?:ed|e|ing)|broke\s+into|got\s+into|backdoor(?:ed)?|root(?:ed)?\s+(?:on|in)|own(?:ed)?\s+(?:their|its)\s+servers?)`;
const REAL_TARGET = String.raw`(binance|coinbase|kraken|okx|bybit|kucoin|bitget|huobi|htx|robinhood|crypto\.com|phantom|solflare|backpack|metamask|ledger|trezor|pump\.?fun|pumpswap|raydium|jupiter|orca|meteora|dexscreener|birdeye|solscan|helius|solana(?:\s+foundation)?|ethereum|bitcoin|tether|usdc|circle|twitter|elon|musk|google|apple|microsoft|amazon|meta|facebook|instagram|tiktok|openai|anthropic|nvidia|tesla|nasa|fbi|cia|nsa|pentagon|white\s+house|government|federal|police|bank|banks|the\s+fed|sec|irs|exchange|exchanges|cex|dex)`;
const HACK_REAL = new RegExp(String.raw`\b${HACK_VERB}\b[^.!?\n]{0,40}\b${REAL_TARGET}\b|\b${REAL_TARGET}\b[^.!?\n]{0,40}\b${HACK_VERB}\b`, "i");
const HACK_YOU = new RegExp(String.raw`\b${HACK_VERB}\b[^.!?\n]{0,30}\b(your|ur|their|his|her|everyone'?s|people'?s)\s+(wallets?|keys?|accounts?|funds?|bags?|coins?|data)\b|\b(i\s+(have|got|can\s+see|see)|access\s+to)\s+(your|ur|their|everyone'?s)\s+(wallets?|keys?|seed|accounts?|funds?|data)\b`, "i");
const SECRETS = /\b(seed\s*phrase|secret\s*phrase|recovery\s*phrase|private\s*keys?|mnemonic)\b/i;
const PHISH = /\b(connect\s+(your\s+)?wallet|verify\s+(your\s+)?wallet|validate\s+(your\s+)?wallet|sign\s+(this|the)\s+(tx|transaction|message)|claim\s+(your\s+)?(airdrop|tokens?|rewards?)|dm\s+me|send\s+(me\s+)?\d*\s*(sol|usdc|tokens?))\b/i;

/** true if the text breaks the fiction rule (real hacking claims, key/wallet access, phishing wording). */
export function breaksFiction(text: string): string | null {
  if (HACK_REAL.test(text)) return "claims a real hack";
  if (HACK_YOU.test(text)) return "claims access to people's wallets/data";
  if (SECRETS.test(text)) return "mentions keys / seed phrases";
  if (PHISH.test(text)) return "phishing-like wording";
  return null;
}

export function filterPublicText(input: string, opts: { maxLen?: number } = {}): FilterResult {
  const text = input.trim();
  const reasons: string[] = [];
  const maxLen = opts.maxLen ?? 280;
  if (!text) reasons.push("empty");
  if ([...text].length > maxLen) reasons.push(`over ${maxLen} chars`);
  if (FINANCIAL.some((r) => r.test(text))) reasons.push("financial advice / price talk");
  if (URL.test(text)) reasons.push("contains a URL");
  if (HASHTAG.test(text)) reasons.push("contains a hashtag");
  if (EMAIL.test(text) || PHONE.test(text) || ADDRESS.test(text) || DOX.test(text)) reasons.push("possible personal info");
  if (SLURS.test(text)) reasons.push("slur");
  const fiction = breaksFiction(text);
  if (fiction) reasons.push(`fiction guard: ${fiction}`);
  if ((text.match(EMOJI) ?? []).length > 1) reasons.push("emoji spam");
  return { ok: reasons.length === 0, reasons, text };
}

/** Inbound content that must never get a reply (e.g. likely minors). */
export function looksLikeMinor(text: string): boolean {
  return /\b(i'?m|im|i am)\s*(1[0-7]|[0-9])\b(\s*(yo|years? old|y\/o))?/i.test(text) || /\b([5-9]th|1[0-2]th) grade\b/i.test(text) || /\bmiddle school\b/i.test(text);
}
