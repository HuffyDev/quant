import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicEvent, PublicState } from "@shared/types";
import { setDisplaySpeed } from "./format";
import { pulseFor, type Pulse } from "./brain/regions";

/** One line of the web chat as the stream overlay shows it. */
export interface ChatLine {
  key: string;
  kind: "in" | "out";
  from: string;
  text: string;
  /** client ms when it arrived live (null = history, shown without typing) */
  liveAt: number | null;
}

interface Store {
  state: PublicState | null;
  /** client time (ms) when state arrived — used to tick the age locally */
  receivedAt: number;
  events: PublicEvent[];
  connected: boolean;
  /** last capability unlock seen live (drives growth bursts) */
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
/** Turn on the chat feed (stream overlay). Loads recent history and resyncs it on every reconnect. */
export function enableChatFeed() {
  if (chatFeed) return;
  chatFeed = true;
  void loadChatHistory();
}
const pushChat = (l: ChatLine) => set({ chat: [...store.chat.filter((x) => x.key !== l.key), l].slice(-CHAT_MAX) });

export function connect() {
  if (socket) return;
  socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    set({ connected: true });
    if (chatFeed) void loadChatHistory();
  });
  socket.on("chat:in", (m: { id: string; from: string; text: string }) => {
    if (chatFeed) pushChat({ key: `i${m.id}`, kind: "in", from: m.from, text: m.text, liveAt: Date.now() });
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
