import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicEvent, PublicState } from "@shared/types";
import { setDisplaySpeed } from "./format";

interface Store {
  state: PublicState | null;
  /** client time (ms) when state arrived — used to tick the age locally */
  receivedAt: number;
  events: PublicEvent[];
  connected: boolean;
  /** last capability unlock seen live (drives growth bursts) */
  lastUnlock: { at: number; caps: string[] } | null;
}

let store: Store = { state: null, receivedAt: 0, events: [], connected: false, lastUnlock: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
};

let socket: Socket | null = null;

export function connect() {
  if (socket) return;
  socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => set({ connected: true }));
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
