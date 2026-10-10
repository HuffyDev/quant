// Event → pin mapping for /core. Pure and dependency-free: used by the server (history) and the client (live).
import type { PublicEvent, Source } from "./types";

export const PIN_REGIONS = ["SOCIAL", "MARKET", "MEMORY", "TREASURY", "DECISIONS", "LANGUAGE", "BREACH"] as const;
export type PinRegion = (typeof PIN_REGIONS)[number];

export const PIN_KINDS = [
  "arc",
  "x_post",
  "x_reply",
  "chat",
  "social",
  "buyback",
  "treasury",
  "memory",
  "proposal",
  "decision",
  "guardian_ok",
  "guardian_reject",
  "market",
  "language",
  "system",
] as const;
export type PinKind = (typeof PIN_KINDS)[number];

/** Filter groups shown on /core. `system` is off by default. */
export const PIN_GROUPS: { key: string; label: string; kinds: PinKind[] }[] = [
  { key: "breakout", label: "Breakout", kinds: ["arc"] },
  { key: "x", label: "X & chat", kinds: ["x_post", "x_reply", "chat", "social"] },
  { key: "treasury", label: "Buybacks", kinds: ["buyback", "treasury"] },
  { key: "memory", label: "Memory", kinds: ["memory"] },
  { key: "decisions", label: "Decisions", kinds: ["proposal", "decision", "guardian_ok"] },
  { key: "rejections", label: "Rejections", kinds: ["guardian_reject"] },
  { key: "market", label: "Market", kinds: ["market"] },
  { key: "language", label: "Language", kinds: ["language"] },
  { key: "system", label: "System", kinds: ["system"] },
];

export const PIN_LABEL: Record<PinKind, string> = {
  arc: "Breakout transmission",
  x_post: "X post",
  x_reply: "X reply",
  chat: "Site chat reply",
  social: "Social read",
  buyback: "Buyback",
  treasury: "Treasury note",
  memory: "Memory",
  proposal: "Proposal",
  decision: "Decision",
  guardian_ok: "Guardian approval",
  guardian_reject: "Guardian rejection",
  market: "Market observation",
  language: "Word learned",
  system: "System log",
};

export interface Pin {
  /** = event id */
  id: number;
  kind: PinKind;
  region: PinRegion;
  red: boolean;
  ts: string;
  /** sim-seconds since launch; null before launch */
  ageS: number | null;
  source: Source;
  content: string;
  proofUrl: string | null;
}

const REGION_OF: Record<PinKind, PinRegion> = {
  arc: "BREACH",
  x_post: "SOCIAL",
  x_reply: "SOCIAL",
  chat: "SOCIAL",
  social: "SOCIAL",
  buyback: "TREASURY",
  treasury: "TREASURY",
  memory: "MEMORY",
  proposal: "DECISIONS",
  decision: "DECISIONS",
  guardian_ok: "DECISIONS",
  guardian_reject: "DECISIONS",
  market: "MARKET",
  language: "LANGUAGE",
  system: "MEMORY",
};

function kindOf(e: Pick<PublicEvent, "type" | "source" | "message" | "data">): PinKind {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const root = e.source === "ROOT";
  switch (e.type) {
    case "ARC":
    case "BOOT":
      return root ? "arc" : "system";
    case "SOCIAL":
      if (e.source === "SYSTEM" && d.postId) return d.mentionId ? "x_reply" : "x_post";
      return root ? "social" : "system";
    case "CHAT":
      return root ? "chat" : "system";
    case "ACTION":
      if (e.source === "SYSTEM" && d.sig) return "buyback";
      return root ? "treasury" : "system";
    case "MEMORY":
      return root ? "memory" : "system";
    case "DECISION":
      return root ? (d.proposalId ? "proposal" : "decision") : "system";
    case "GUARDIAN":
      return d.approved === false ? "guardian_reject" : d.approved === true ? "guardian_ok" : "system";
    case "MARKET":
      return root ? "market" : "system";
    case "LEARN":
      return root ? "language" : "system";
    default:
      return "system";
  }
}

/** Every event becomes a pin; `system` pins are the operational log (hidden by default on /core). */
export function pinFromEvent(e: PublicEvent): Pin {
  const kind = kindOf(e);
  const d = (e.data ?? {}) as Record<string, unknown>;
  const content = (kind === "x_post" || kind === "x_reply") && typeof d.text === "string" ? d.text : kind === "chat" && typeof d.reply === "string" ? `${d.from ?? "visitor"} → ${d.reply}` : e.message;
  return { id: e.id, kind, region: REGION_OF[kind], red: kind === "guardian_reject", ts: e.ts, ageS: e.ageS, source: e.source, content, proofUrl: e.proofUrl };
}

/** Human label for a proof link. */
export function proofLabel(url: string): string {
  if (/(^https?:\/\/)?(x|twitter)\.com\//.test(url) || url.startsWith("/sim/x/")) return "View on X";
  if (/solscan\.io/.test(url) || url.startsWith("/sim/tx/")) return "View on Solscan";
  return "Proof";
}
