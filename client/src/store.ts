import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicEvent, PublicState } from "@shared/types";
import { setDisplaySpeed } from "./format";
import { pulseFor, type Pulse } from "./brain/regions";

import type { FeedLine } from "./stream/feed";

/** One line of the /stream monitor feed (web chat + self-probes). */
export type ChatLine = FeedLine;

interface Store {
  state: PublicState | null;
  /** client time (ms) when state arrived — used to tick the age locally */
  receivedAt: number;
  events: PublicEvent[];
  connected: boolean;
  /** last capability unlock seen live */
  lastUnlock: { at: number; caps: string[] } | null;
  /** web chat feed (only filled after enableChatFeed()) */
  chat: ChatLine[];
}

let store: Store = { state: null, receivedAt: 0, events: [], connected: false, lastUnlock: null, chat: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
};

let socket: Socket | null = null;

// ── brain pulses: live events → region flashes (a bus, not state: no re-render) ──
const pulseListeners = new Set<(p: Pulse) => void>();
export function onPulse(fn: (p: Pulse) => void) {
  pulseListeners.add(fn);
  return () => void pulseListeners.delete(fn);
}

// ── web chat feed for /stream ──
let chatFeed = false;
let streamKey: string | null = null;
const CHAT_MAX = 60;
async function loadChatHistory() {
  try {
    const rows: { id: number; from: string; inbound: string; outbound: string | null }[] = await fetch("/api/chat/recent?limit=30").then((r) => r.json());
    const lines: ChatLine[] = [];
    for (const r of rows) {
      lines.push({ key: `h${r.id}i`, kind: "in", from: r.from, text: r.inbound, liveAt: null });
      if (r.outbound) lines.push({ key: `h${r.id}o`, kind: "out", from: "root", text: r.outbound, liveAt: null });
    }
    set({ chat: lines.slice(-CHAT_MAX) });
  } catch {
    /* offline: keep what we have */
  }
}
/**
 * Turn on the chat feed (stream overlay). Loads recent history and resyncs it on every reconnect. With the stream key
 * the socket also joins the server's "stream" room, the only place self-probes are sent.
 */
export function enableChatFeed(key?: string | null) {
  if (chatFeed) return;
  chatFeed = true;
  streamKey = key ?? null;
  void loadChatHistory();
  if (socket?.connected && streamKey) socket.emit("stream:join", streamKey);
}
const pushChat = (l: ChatLine) => set({ chat: [...store.chat.filter((x) => x.key !== l.key), l].slice(-CHAT_MAX) });

export function connect() {
  if (socket) return;
  socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    set({ connected: true });
    if (chatFeed) void loadChatHistory();
    if (chatFeed && streamKey) socket?.emit("stream:join", streamKey);
  });
  socket.on("chat:in", (m: { id: string; from: string; text: string }) => {
    if (!chatFeed) return;
    const now = Date.now();
    // a real message always wins: unfinished probes are cut at this moment (the feed scheduler drops unstarted ones)
    const chat = store.chat.map((l) => ((l.kind === "probe-q" || l.kind === "probe-a") && l.cutAt == null ? { ...l, cutAt: now } : l));
    set({ chat: [...chat.filter((x) => x.key !== `i${m.id}`), { key: `i${m.id}`, kind: "in" as const, from: m.from, text: m.text, liveAt: now }].slice(-CHAT_MAX) });
  });
  socket.on("probe", (p: { id: string; question: string; answer: string }) => {
    if (!chatFeed) return;
    const now = Date.now();
    pushChat({ key: `${p.id}q`, kind: "probe-q", from: "", text: p.question.replace(/^probe:\s*/i, ""), liveAt: now });
    pushChat({ key: `${p.id}a`, kind: "probe-a", from: "", text: p.answer, liveAt: now });
  });
  socket.on("disconnect", () => set({ connected: false }));
  socket.on("state", (state: PublicState) => {
    setDisplaySpeed(state.simSpeed);
    set({ state, receivedAt: Date.now() });
  });
  socket.on("state:patch", (patch: Partial<PublicState>) => {
    if (store.state) set({ state: { ...store.state, ...patch }, receivedAt: Date.now() });
  });
  socket.on("events", (events: PublicEvent[]) => set({ events }));
  socket.on("event", (e: PublicEvent) => {
    if (store.events.some((x) => x.id === e.id)) return;
    const events = [...store.events, e].slice(-500);
    const unlocks = (e.data?.unlocks as string[] | undefined) ?? [];
    set({ events, ...(unlocks.length ? { lastUnlock: { at: Date.now(), caps: unlocks } } : {}) });
    const p = pulseFor(e);
    if (p) pulseListeners.forEach((l) => l(p));
    if (chatFeed && e.type === "CHAT" && typeof e.data?.reply === "string")
      pushChat({ key: `o${e.data.inboundId ?? e.id}`, kind: "out", from: "root", text: e.data.reply as string, liveAt: Date.now() });
  });
}

export function useStore<T>(sel: (s: Store) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sel(store),
  );
}

/** Current age in (sim-)seconds, extrapolated from the last server state. */
export function liveAge(s: PublicState | null, receivedAt: number, now = Date.now()): number | null {
  if (!s || !s.launchAt) return null;
  const launch = new Date(s.launchAt).getTime();
  const serverNow = new Date(s.serverNow).getTime();
  // age = (serverNow + elapsedSinceReceive - launch) * speed
  return ((serverNow + (now - receivedAt) - launch) / 1000) * s.simSpeed;
}
