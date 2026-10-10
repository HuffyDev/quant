import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PIN_GROUPS, PIN_LABEL, pinFromEvent, proofLabel, type Pin } from "@shared/pins";
import { useStore } from "../store";
import { initialTier } from "../brain/QuantumBrain";
import { regionActivity } from "../brain/regions";
import { toReal } from "../format";
import { SourceBadge } from "../components/Terminal";
import { Icon } from "../components/ui";

const CoreCanvas = lazy(() => import("./CoreCanvas"));

/**
 * /core — QUANTUM CORE. Full-screen interactive brain where every event is a pin on its region.
 * Filters by type, a side card per pin, a scrubber that replays pins from the first one, live pins via Socket.IO.
 * Without WebGL (or on a device that can't hold the frame rate) it becomes a filterable list.
 */

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const GROUP_OF = new Map(PIN_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.key] as const)));
const DEFAULT_GROUPS = new Set(PIN_GROUPS.filter((g) => g.key !== "system").map((g) => g.key));

function fmtAge(ageS: number | null): string {
  if (ageS === null) return "pre-launch";
  const s = Math.max(0, toReal(ageS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `T+${h}h ${String(m).padStart(2, "0")}m` : `T+${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
const fmtStamp = (iso: string) => new Date(iso).toLocaleString([], { hour12: false, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function usePins() {
  const [pins, setPins] = useState<Pin[]>([]);
  const newSince = useRef(new Map<number, number>());
  const events = useStore((s) => s.events);
  const connected = useStore((s) => s.connected);
  const maxId = useRef(0);

  const load = useCallback(async () => {
    try {
      const rows: Pin[] = await fetch("/api/core/pins?system=1").then((r) => r.json());
      setPins((cur) => {
        const byId = new Map(cur.map((p) => [p.id, p]));
        for (const p of rows) byId.set(p.id, p);
        const all = [...byId.values()].sort((a, b) => a.id - b.id);
        maxId.current = Math.max(maxId.current, all.at(-1)?.id ?? 0);
        return all;
      });
    } catch {
      /* offline: the live feed fills in on reconnect */
    }
  }, []);

  // history on mount and after every reconnect (a sim reset also clears everything)
  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  // live: new events become pins as they arrive
  useEffect(() => {
    const fresh = events.filter((e) => e.id > maxId.current);
    if (!fresh.length) return;
    if (events.length && events[events.length - 1].id < maxId.current - 50) return; // stale buffer after a reset
    const now = Date.now();
    // only pins that arrive after history loaded drop in with a pulse
    if (maxId.current > 0) for (const e of fresh) newSince.current.set(e.id, now);
    maxId.current = fresh[fresh.length - 1].id;
    setPins((cur) => [...cur, ...fresh.map(pinFromEvent)]);
  }, [events]);

  // sim reset: event ids restart — reload everything
  useEffect(() => {
    if (events.length && events[events.length - 1].id < maxId.current - 50) {
      maxId.current = 0;
      setPins([]);
      void load();
    }
  }, [events, load]);

  return { pins, newSince: newSince.current };
}

function PinCard({ pin, onClose }: { pin: Pin; onClose: () => void }) {
  return (
    <aside className="core-card fade-up" aria-label="Event details">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`font-mono text-[10px] tracking-[0.22em] uppercase ${pin.red ? "text-alarm" : "text-ice"}`}>
            {PIN_LABEL[pin.kind]} · {pin.region}
          </div>
          <div className="mt-1 font-mono text-[11px] text-mute">#{pin.id}</div>
        </div>
        <button className="btn h-8 min-h-0 w-8 px-0" aria-label="Close" onClick={onClose}>
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-3 max-h-[38vh] overflow-y-auto break-words font-mono text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{pin.content}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
        <dt className="text-mute">Time</dt>
        <dd className="tnum text-silver">{fmtStamp(pin.ts)}</dd>
        <dt className="text-mute">ROOT's age</dt>
        <dd className="tnum text-silver">{fmtAge(pin.ageS)}</dd>
        <dt className="text-mute">Source</dt>
        <dd>
          <SourceBadge source={pin.source} />
        </dd>
      </dl>
      {pin.proofUrl && (
        <a href={pin.proofUrl} target="_blank" rel="noreferrer" className="btn btn-solid mt-4 w-full">
          {proofLabel(pin.proofUrl)} <Icon name="ext" className="h-3 w-3" />
        </a>
      )}
    </aside>
  );
}

/** Histogram + range: replay pins from the first one. `cursor` null = live. */
function Scrubber({ pins, cursor, setCursor, playing, setPlaying }: { pins: Pin[]; cursor: number | null; setCursor: (v: number | null) => void; playing: boolean; setPlaying: (v: boolean) => void }) {
  const launchAt = useStore((s) => s.state?.launchAt ?? null);
  const t0 = pins.length ? new Date(pins[0].ts).getTime() : Date.now();
  const t1 = Math.max(Date.now(), t0 + 1000);
  const value = cursor ?? t1;
  const bins = useMemo(() => {
    const n = 64;
    const b = new Array(n).fill(0);
    for (const p of pins) b[Math.min(n - 1, Math.floor(((new Date(p.ts).getTime() - t0) / (t1 - t0)) * n))]++;
    const max = Math.max(1, ...b);
    return b.map((v) => v / max);
  }, [pins, t0, t1]);
  const launchPct = launchAt ? ((new Date(launchAt).getTime() - t0) / (t1 - t0)) * 100 : null;

  // replay: sweep the whole span in ~30s
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = 0;
    const step = (t: number) => {
      const dt = t - last;
      last = t;
      const span = t1 - t0;
      const next = (cursor ?? t0) + (span / 30_000) * dt;
      if (next >= t1) {
        setCursor(null);
        setPlaying(false);
        return;
      }
      setCursor(next);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  });

  return (
    <div className="core-scrubber">
      <button className="btn h-9 min-h-0 shrink-0 px-3" onClick={() => (playing ? setPlaying(false) : (cursor === null && setCursor(t0), setPlaying(true)))} aria-label={playing ? "Pause replay" : "Replay from the start"}>
        {playing ? "❚❚" : "▶"} <span className="hidden sm:inline">{playing ? "Pause" : "Replay"}</span>
      </button>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 bottom-[14px] flex h-6 items-end gap-px" aria-hidden>
          {bins.map((v, i) => (
            <span key={i} className="flex-1 bg-ice/40" style={{ height: `${Math.max(4, v * 100)}%`, opacity: (i + 0.5) / bins.length <= (value - t0) / (t1 - t0) ? 1 : 0.25 }} />
          ))}
        </div>
        {launchPct !== null && launchPct > 0 && launchPct < 100 && <span className="pointer-events-none absolute bottom-[10px] h-8 w-px bg-ice" style={{ left: `${launchPct}%` }} title="launch" />}
        <input
          type="range"
          className="core-range"
          min={t0}
          max={t1}
          step={1000}
          value={value}
          aria-label="Replay position"
          onChange={(e) => {
            setPlaying(false);
            const v = Number(e.target.value);
            setCursor(v >= t1 - 1500 ? null : v);
          }}
        />
      </div>
      <div className="tnum w-[92px] shrink-0 text-right font-mono text-[11px] text-silver sm:w-[150px]">
        {cursor === null ? (
          <span className="text-ice">● LIVE</span>
        ) : (
          new Date(cursor).toLocaleTimeString([], { hour12: false })
        )}
      </div>
    </div>
  );
}

function PinList({ pins, onSelect }: { pins: Pin[]; onSelect: (id: number) => void }) {
  return (
    <ol className="core-list scroll-thin">
      {pins.length === 0 && <li className="p-4 font-mono text-[12px] text-mute">No events match.</li>}
      {[...pins].reverse().slice(0, 300).map((p) => (
        <li key={p.id}>
          <button className="flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-white/[0.03]" onClick={() => onSelect(p.id)}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full pin-dot-${p.region.toLowerCase()} ${p.red ? "pin-dot-red" : ""}`} />
            <span className="min-w-0">
              <span className="block font-mono text-[10px] tracking-[0.16em] text-mute uppercase">
                {PIN_LABEL[p.kind]} · {fmtAge(p.ageS)}
              </span>
              <span className="line-clamp-2 text-[13px] text-silver">{p.content}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function Core() {
  const { pins, newSince } = usePins();
  const state = useStore((s) => s.state);
  const connected = useStore((s) => s.connected);
  const [groups, setGroups] = useState<Set<string>>(DEFAULT_GROUPS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const start = useMemo(initialTier, []);
  const [gaveUp, setGaveUp] = useState(false);
  const giveUp = useCallback(() => setGaveUp(true), []);
  const use3D = start !== null && !gaveUp;

  useEffect(() => {
    document.title = "QUANTUM CORE · ROOT";
    const b = document.body.style;
    const prev = b.overflow;
    b.overflow = "hidden";
    return () => {
      b.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of pins) c.set(GROUP_OF.get(p.kind)!, (c.get(GROUP_OF.get(p.kind)!) ?? 0) + 1);
    return c;
  }, [pins]);
  const visible = useMemo(() => pins.map((p) => groups.has(GROUP_OF.get(p.kind)!) && (cursor === null || new Date(p.ts).getTime() <= cursor)), [pins, groups, cursor]);
  const shown = useMemo(() => pins.filter((_, i) => visible[i]), [pins, visible]);
  const selected = selectedId !== null ? (pins.find((p) => p.id === selectedId) ?? null) : null;
  const activeKey = regionActivity(state?.capabilities).join("");
  const active = useMemo(() => regionActivity(state?.capabilities), [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const prelaunch = !state || state.ageS === null || state.ageS < 0;

  const toggle = (k: string) =>
    setGroups((g) => {
      const n = new Set(g);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="core-page">
      <header className="core-top">
        <a href="/" className="flex shrink-0 items-center gap-2" aria-label="Back to ROOT">
          <img src="/root.png" alt="" className="h-7 w-7 rounded-[3px] border border-ice/40 object-contain" />
          <span className="display text-[14px] tracking-[0.06em] text-ink uppercase">ROOT</span>
        </a>
        <h1 className="font-mono text-[11px] tracking-[0.3em] text-ice uppercase">Quantum core</h1>
        <span className={`ml-auto pill ${connected ? "text-ink" : "border-alarm/50 text-alarm"}`}>
          <span className={`dot ${connected ? "dot-live" : ""}`} />
          <span className="hidden sm:inline">{connected ? `${shown.length} pins` : "Reconnecting"}</span>
        </span>
      </header>

      <div className="core-filters no-scrollbar" role="group" aria-label="Filter pins by type">
        {PIN_GROUPS.map((g) => (
          <button key={g.key} className={`chip core-chip core-chip-${g.key}`} aria-pressed={groups.has(g.key)} onClick={() => toggle(g.key)}>
            {g.label} <span className="tnum opacity-60">{counts.get(g.key) ?? 0}</span>
          </button>
        ))}
      </div>

      <main className="core-stage">
        {use3D ? (
          <GLBoundary fallback={<PinList pins={shown} onSelect={setSelectedId} />}>
            <Suspense fallback={<div className="grid h-full place-items-center font-mono text-[11px] tracking-[0.2em] text-dim uppercase">loading core…</div>}>
              <CoreCanvas pins={pins} visible={visible} selectedId={selectedId} newSince={newSince} onSelect={setSelectedId} level={prelaunch ? 0.3 : (state?.brainLevel ?? 0.5)} active={active} startTier={start} onGiveUp={giveUp} />
            </Suspense>
          </GLBoundary>
        ) : (
          <div className="flex h-full flex-col">
            <div className="relative h-[28vh] shrink-0">
              <img src="/root.png" alt="ROOT" className="static-brain mx-auto h-full w-auto object-contain" />
            </div>
            <PinList pins={shown} onSelect={setSelectedId} />
          </div>
        )}
        {use3D && <div className="core-hint">drag to rotate · scroll / pinch to zoom · tap a pin</div>}
        {selected && <PinCard pin={selected} onClose={() => setSelectedId(null)} />}
      </main>

      <Scrubber pins={pins.filter((p) => groups.has(GROUP_OF.get(p.kind)!))} cursor={cursor} setCursor={setCursor} playing={playing} setPlaying={setPlaying} />
    </div>
  );
}
