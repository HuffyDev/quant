import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enableChatFeed, useStore, type ChatLine } from "../store";
import { useAge, realSeconds } from "../hooks";
import { fmtUsd, timeOf } from "../format";
import { regionActivity } from "../brain/regions";
import { initialTier } from "../brain/QuantumBrain";
import { StaticBrain } from "../brain/BrainStage";
import { monitorTransform, parseStreamParams, streamQuery, typedLength, type StreamParams } from "./params";

const QuantumBrain = lazy(() => import("../brain/QuantumBrain"));

/**
 * /stream — 1920×1080 OBS browser source for the pump.fun livestream. Full-screen looping video, the live site chat
 * composited onto the monitor in the video, a side ticker and a mini brain. No scroll, no cursor, no site chrome.
 * Socket.IO reconnects on its own; if the link stays down for 60s the page reloads itself.
 */

const W = 1920;
const H = 1080;

function useStageScale() {
  const [s, setS] = useState(1);
  useEffect(() => {
    const fit = () => setS(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return s;
}

/** Re-render at ~30fps while something is typing (a timer, not rAF: rAF can be throttled in capture tools). */
function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 33);
    return () => clearInterval(id);
  }, [active]);
}

interface FeedLine {
  key: string;
  kind: "in" | "out";
  from: string;
  text: string;
  liveAt: number | null;
}

/** Replies type out one after another: a reply starts when the previous one has finished. */
function schedule(lines: FeedLine[], cps: number) {
  let free = 0;
  return lines.map((l) => {
    if (l.kind !== "out" || l.liveAt === null) return { ...l, startAt: null as number | null };
    const startAt = Math.max(l.liveAt, free);
    free = startAt + (l.text.length / cps) * 1000 + 250;
    return { ...l, startAt };
  });
}

function Monitor({ p, lines, title }: { p: StreamParams; lines: FeedLine[]; title: string }) {
  const sched = useMemo(() => schedule(lines, p.cps), [lines, p.cps]);
  const typingUntil = sched.reduce((m, l) => (l.startAt !== null ? Math.max(m, l.startAt + (l.text.length / p.cps) * 1000) : m), 0);
  const now = Date.now();
  useTicker(typingUntil > now);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ fontSize: p.fs }}>
      <div className="stream-mon-bar flex items-center gap-2 px-[0.8em] py-[0.35em] text-[0.62em]">
        <span className="h-[0.7em] w-[0.7em] rounded-full bg-[#ff5f57]/70" />
        <span className="h-[0.7em] w-[0.7em] rounded-full bg-[#febc2e]/60" />
        <span className="h-[0.7em] w-[0.7em] rounded-full bg-[#28c840]/60" />
        <span className="ml-2 truncate">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-[0.3em] overflow-hidden px-[0.8em] pb-[0.6em] pt-[0.3em] leading-[1.3]">
        {sched.slice(-14).map((l) => {
          if (l.kind === "in")
            return (
              <div key={l.key} className="stream-in break-words">
                <span className="stream-from">{l.from}&gt;</span> {l.text}
              </div>
            );
          const shown = l.startAt === null ? l.text.length : now < l.startAt ? -1 : typedLength(l.text, now - l.startAt, p.cps);
          if (shown < 0) return null;
          const typing = shown < l.text.length;
          return (
            <div key={l.key} className="stream-out break-words">
              <span className="stream-root">root#</span> {l.text.slice(0, shown)}
              {typing && <span className="stream-caret">▌</span>}
            </div>
          );
        })}
        <div className="stream-in">
          <span className="stream-root">root#</span> <span className="stream-caret blink">▌</span>
        </div>
      </div>
    </div>
  );
}

function MiniBrain() {
  const caps = useStore((s) => s.state?.capabilities);
  const level = useStore((s) => s.state?.brainLevel ?? 0);
  const dormant = useStore((s) => (s.state?.ageS ?? -1) < 0);
  const start = useMemo(initialTier, []);
  const [gaveUp, setGaveUp] = useState(false);
  const giveUp = useCallback(() => setGaveUp(true), []);
  const key = regionActivity(caps).join("");
  const active = useMemo(() => regionActivity(caps), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative h-[300px] w-full overflow-hidden rounded-[4px] border border-ice/25 bg-black">
      {start && !gaveUp ? (
        <Suspense fallback={null}>
          <QuantumBrain level={dormant ? 0.04 : level} active={active} startTier={start} maxTier="mid" onGiveUp={giveUp} spin={0.2} />
        </Suspense>
      ) : (
        <StaticBrain dormant={dormant} />
      )}
    </div>
  );
}

function Ticker({ side }: { side: "left" | "right" }) {
  const { age, state, now } = useAge(1000);
  const connected = useStore((s) => s.connected);
  if (!state) return null;
  const prelaunch = age === null || age < 0;
  const up = realSeconds(Math.max(0, age ?? 0), state.simSpeed);
  const hh = String(Math.floor(up / 3600)).padStart(2, "0");
  const mm = String(Math.floor((up % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(up % 60)).padStart(2, "0");
  const last = state.actions[0];
  const launchIn = state.launchAt ? (new Date(state.launchAt).getTime() - now) / 1000 : null;
  const arcDone = state.arc.beats.filter((b) => b.fired || b.skipped).length;
  return (
    <aside className={`stream-ticker absolute top-[40px] bottom-[40px] w-[360px] ${side === "left" ? "left-[40px]" : "right-[40px]"} flex flex-col gap-5 p-6`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/root.png" alt="" className="h-10 w-10 rounded-[3px] object-contain" />
          <div>
            <div className="display text-[26px] leading-none text-ink">ROOT</div>
            <div className="font-mono text-[13px] tracking-[0.2em] text-ice">$ROOT</div>
          </div>
        </div>
        <span className={`flex items-center gap-2 font-mono text-[12px] tracking-[0.18em] uppercase ${connected ? "text-ice" : "text-alarm"}`}>
          <span className={`dot ${connected ? "dot-live" : ""}`} />
          {connected ? "live" : "relink"}
        </span>
      </div>

      <MiniBrain />

      <div>
        <div className="stream-k">{prelaunch ? (launchIn !== null && launchIn > 0 ? "launch in" : "breakout") : "uptime"}</div>
        <div className="tnum ice-text glow font-mono text-[46px] leading-none">
          {prelaunch
            ? launchIn !== null && launchIn > 0
              ? `${String(Math.floor(launchIn / 3600)).padStart(2, "0")}:${String(Math.floor((launchIn % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(launchIn % 60)).padStart(2, "0")}`
              : `${arcDone}/${state.arc.total}`
            : `${hh}:${mm}:${ss}`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat k="mcap" v={fmtUsd(state.vitals.mcapUsd)} />
        <Stat k="holders" v={state.vitals.holders?.toLocaleString() ?? "—"} />
        <Stat k="treasury" v={state.vitals.treasurySol !== null ? `${state.vitals.treasurySol.toFixed(2)} SOL` : "—"} />
        <Stat k="stage" v={state.stage} />
      </div>

      <div className="mt-auto">
        <div className="stream-k">last action</div>
        {last ? (
          <div className="font-mono text-[15px] leading-snug text-silver">
            <span className="text-ice">{last.type.replace("_", " ").toLowerCase()}</span>
            {last.amountSol !== null && <span className="text-ink"> {last.amountSol} sol</span>}
            <span className="text-mute"> · {timeOf(last.ts)}</span>
            {last.summary && <div className="mt-1 line-clamp-3 text-[14px] text-dim">{last.summary}</div>}
          </div>
        ) : (
          <div className="font-mono text-[15px] text-mute">—</div>
        )}
      </div>
      <div className="font-mono text-[11px] tracking-[0.14em] text-mute uppercase">fiction · ai-generated · guardian-checked · not financial advice</div>
    </aside>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div>
    <div className="stream-k">{k}</div>
    <div className="tnum truncate font-mono text-[22px] text-ink">{v}</div>
  </div>
);

/** Drag the box, drag the corner to resize, [ ] to rotate (shift = fine). Prints the URL for OBS. */
function Calibrator({ p, set, scale }: { p: StreamParams; set: (p: StreamParams) => void; scale: number }) {
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; p: StreamParams } | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const d = e.shiftKey ? 0.1 : 0.5;
      if (e.key === "[") set({ ...p, rotate: p.rotate - d });
      if (e.key === "]") set({ ...p, rotate: p.rotate + d });
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") set({ ...p, x: p.x - step });
      if (e.key === "ArrowRight") set({ ...p, x: p.x + step });
      if (e.key === "ArrowUp") set({ ...p, y: p.y - step });
      if (e.key === "ArrowDown") set({ ...p, y: p.y + step });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [p, set]);
  const down = (mode: "move" | "size") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, p };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    set(d.mode === "move" ? { ...d.p, x: d.p.x + dx, y: d.p.y + dy } : { ...d.p, w: Math.max(40, d.p.w + dx), h: Math.max(40, d.p.h + dy) });
  };
  const url = `${location.origin}/stream?${streamQuery(p)}`;
  return (
    <>
      <div
        className="absolute z-30 cursor-move border-2 border-dashed border-ice"
        style={{ left: p.x, top: p.y, width: p.w, height: p.h, transform: monitorTransform(p), transformOrigin: "50% 50%" }}
        onPointerDown={down("move")}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
      >
        <div className="absolute -right-3 -bottom-3 h-6 w-6 cursor-nwse-resize bg-ice" onPointerDown={down("size")} onPointerMove={move} onPointerUp={() => (drag.current = null)} />
      </div>
      <div className="absolute bottom-6 left-6 z-30 max-w-[1200px] rounded bg-black/85 p-4 font-mono text-[16px] text-ink">
        <div className="mb-2 text-ice">calibration · drag box · drag corner to resize · [ ] rotate · arrows nudge (shift = more/finer)</div>
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="w-[1100px] bg-black px-2 py-1 text-[15px] text-ink outline outline-1 outline-ice/50" />
      </div>
    </>
  );
}

export default function Stream() {
  const [p, setP] = useState(() => parseStreamParams(location.search));
  const scale = useStageScale();
  const chat = useStore((s) => s.chat);
  const events = useStore((s) => s.events);
  const state = useStore((s) => s.state);
  const connected = useStore((s) => s.connected);
  const [videoOk, setVideoOk] = useState(true);

  useEffect(() => {
    enableChatFeed();
    document.title = "ROOT · stream";
    const b = document.body.style;
    const prev = { overflow: b.overflow, cursor: b.cursor, background: b.background };
    b.overflow = "hidden";
    b.background = "#000";
    if (!p.calibrate) b.cursor = "none";
    return () => {
      Object.assign(b, prev);
    };
  }, [p.calibrate]);

  // hard fallback for long outages (OBS sources can wedge): reload after 60s offline
  useEffect(() => {
    if (connected) return;
    const id = setTimeout(() => location.reload(), 60_000);
    return () => clearTimeout(id);
  }, [connected]);

  const prelaunch = !state || state.ageS === null || state.ageS < 0;
  // pre-launch: the monitor shows the breakout transmissions instead of chat. Lines already there on load are
  // shown whole; lines that arrive live type out (first-seen time is remembered so re-renders don't restart them).
  const seen = useRef<Map<number, number | null> | null>(null);
  const lines: FeedLine[] = useMemo(() => {
    if (!prelaunch) return chat as ChatLine[];
    const arc = events.filter((e) => e.type === "ARC" && e.source === "ROOT");
    if (!seen.current) seen.current = new Map(arc.map((e) => [e.id, null]));
    for (const e of arc) if (!seen.current.has(e.id)) seen.current.set(e.id, Date.now());
    return arc.map((e) => ({ key: `arc${e.id}`, kind: "out" as const, from: "root", text: e.message, liveAt: seen.current!.get(e.id) ?? null }));
  }, [prelaunch, chat, events]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "50% 50%" }}>
        {videoOk ? (
          <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline>
            <source src={p.video} type="video/mp4" />
            {/* fallback for browsers without H.264 (OBS / Chrome play the mp4) */}
            <source src={p.video.replace(/\.mp4$/, ".webm")} type="video/webm" onError={() => setVideoOk(false)} />
          </video>
        ) : (
          <div className="stream-novideo absolute inset-0" />
        )}

        <div className="stream-monitor absolute" style={{ left: p.x, top: p.y, width: p.w, height: p.h, transform: monitorTransform(p), transformOrigin: "50% 50%" }}>
          <Monitor p={p} lines={lines} title={prelaunch ? "root@system:~# tail -f breakout.log" : "root@root:~# tail -f /var/chat"} />
        </div>

        {p.ticker !== "off" && <Ticker side={p.ticker} />}
        {p.calibrate && <Calibrator p={p} set={setP} scale={scale} />}
      </div>
    </div>
  );
}
