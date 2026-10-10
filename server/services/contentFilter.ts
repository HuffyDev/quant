/**
 * Hard content filter applied to anything Baby says publicly (X posts, replies, chat).
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
  if ((text.match(EMOJI) ?? []).length > 1) reasons.push("emoji spam");
  return { ok: reasons.length === 0, reasons, text };
}

/** Inbound content that must never get a reply (e.g. likely minors). */
export function looksLikeMinor(text: string): boolean {
  return /\b(i'?m|im|i am)\s*(1[0-7]|[0-9])\b(\s*(yo|years? old|y\/o))?/i.test(text) || /\b([5-9]th|1[0-2]th) grade\b/i.test(text) || /\bmiddle school\b/i.test(text);
}
