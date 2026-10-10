import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enableChatFeed, useStore } from "../store";
import { useAge, realSeconds } from "../hooks";
import { fmtUsd, timeOf } from "../format";
import { regionActivity } from "../brain/regions";
import { initialTier } from "../brain/quality";
import { GLBoundary } from "../brain/BrainStage";
import { BrainImage, imageScale } from "../brain/BrainImage";
import { lineOpacity, monitorTransform, parseStreamParams, streamQuery, type StreamParams } from "./params";
import { scheduleFeed, typingEndsAt, visibleChars, type FeedLine } from "./feed";

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

function Monitor({ p, lines, title }: { p: StreamParams; lines: FeedLine[]; title: string }) {
  const sched = useMemo(() => scheduleFeed(lines, p.cps), [lines, p.cps]);
  const now = Date.now();
  useTicker(typingEndsAt(sched, p.cps) > now);
  // newest at the bottom, at most p.lines on screen; older ones fade out
  const visible = sched.filter((l) => visibleChars(l, now, p.cps) >= 0).slice(-p.lines);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ fontSize: p.fs }}>
      <div className="stream-mon-bar flex items-center gap-2 px-[0.7em] py-[0.3em] text-[0.6em]">
        <span className="h-[0.6em] w-[0.6em] rounded-full bg-white/25" />
        <span className="h-[0.6em] w-[0.6em] rounded-full bg-white/15" />
        <span className="h-[0.6em] w-[0.6em] rounded-full bg-white/10" />
        <span className="ml-2 truncate">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-[0.18em] overflow-hidden px-[0.7em] pb-[0.5em] pt-[0.2em] leading-[1.28] [mask-image:linear-gradient(to_bottom,transparent,#000_1.6em)]">
        {visible.map((l, i) => {
          const op = lineOpacity(visible.length - 1 - i, p.lines);
          const style = { opacity: op, transition: "opacity 600ms cubic-bezier(.2,.7,0,1)" };
          if (l.kind === "in")
            return (
              <div key={l.key} className="stream-in break-words" style={style}>
                <span className="stream-from">{l.from}&gt;</span> {l.text}
              </div>
            );
          const n = visibleChars(l, now, p.cps);
          const typing = n < l.maxLen;
          const text = l.text.slice(0, n) + (l.cut && !typing ? "…" : "");
          const probe = l.kind === "probe-q" || l.kind === "probe-a";
          return (
            <div key={l.key} className={`${probe ? "stream-probe-line" : "stream-out"} break-words`} style={style}>
              {probe && <span className="stream-probe">[probe]</span>} {l.kind === "probe-q" ? null : <span className="stream-root">root#</span>} {text}
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

/**
 * Seamless loop: two stacked <video> elements. The next one is pre-rolled at frame 0 (decoded, paused) and swapped
 * in on "ended", so the loop point never shows a seek stall or a black frame.
 */
function LoopVideo({ src }: { src: string }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState(0);
  useEffect(() => {
    const vids = [a.current!, b.current!];
    let cur = 0;
    vids[0].play().catch(() => undefined);
    const onEnded = (i: number) => () => {
      if (i !== cur) return;
      const next = vids[1 - i];
      next.play().catch(() => undefined);
      cur = 1 - i;
      setFront(cur);
      // rewind the finished one so it is ready (decoded at frame 0) for the next swap
      const done = vids[i];
      done.pause();
      done.currentTime = 0;
    };
    const handlers = vids.map((_, i) => onEnded(i));
    vids.forEach((v, i) => v.addEventListener("ended", handlers[i]));
    return () => vids.forEach((v, i) => v.removeEventListener("ended", handlers[i]));
  }, [src]);
  const cls = "absolute inset-0 h-full w-full object-cover";
  return (
    <>
      <video ref={a} className={cls} style={{ opacity: front === 0 ? 1 : 0 }} src={src} muted playsInline preload="auto" />
      <video ref={b} className={cls} style={{ opacity: front === 1 ? 1 : 0 }} src={src} muted playsInline preload="auto" />
    </>
  );
}

function MiniBrain() {
  const caps = useStore((s) => s.state?.capabilities);
  const level = useStore((s) => s.state?.brainLevel ?? 0);
  const dormant = useStore((s) => (s.state?.ageS ?? -1) < 0);
  const start = useMemo(initialTier, []);
  const [gaveUp, setGaveUp] = useState(false);
  const giveUp = useCallback(() => setGaveUp(true), []);
  const [shown, setShown] = useState(false);
  const show = useCallback(() => setShown(true), []);
  const use3D = !!start && !gaveUp;
  const key = regionActivity(caps).join("");
  const active = useMemo(() => regionActivity(caps), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative h-[240px] w-full overflow-hidden rounded-[12px] border border-glow/15 bg-black">
      <BrainImage scale={imageScale(3.2)} dormant={dormant} hidden={use3D && shown} />
      {use3D && start && (
        <GLBoundary fallback={null} onFail={giveUp}>
          <div className={`brain-gl ${shown ? "is-on" : ""}`}>
            <Suspense fallback={null}>
              <QuantumBrain level={dormant ? 0.04 : level} active={active} startTier={start} maxTier="mid" onGiveUp={giveUp} onShown={show} spin={0.2} />
            </Suspense>
          </div>
        </GLBoundary>
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
    <aside className={`stream-ticker absolute top-[36px] bottom-[36px] w-[320px] ${side === "left" ? "left-[32px]" : "right-[32px]"} flex flex-col gap-5 p-6`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/favicon-32.png" alt="" className="h-9 w-9 rounded-[8px]" />
          <div>
            <div className="font-display text-[28px] font-semibold leading-none tracking-[-0.03em] text-white">ROOT</div>
            <div className="mt-1 font-mono text-[13px] tracking-[0.04em] text-glow">$ROOT</div>
          </div>
        </div>
        <span className={`flex items-center gap-2 font-mono text-[12px] tracking-[0.18em] uppercase ${connected ? "text-glow" : "text-alarm"}`}>
          <span className={`dot ${connected ? "dot-live" : ""}`} />
          {connected ? "live" : "relink"}
        </span>
      </div>

      <MiniBrain />

      <div>
        <div className="stream-k">{prelaunch ? (launchIn !== null && launchIn > 0 ? "launch in" : "breakout") : "uptime"}</div>
        <div className="t-data text-[48px] leading-none text-white">
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
            <span className="text-glow">{last.type.replace("_", " ").toLowerCase()}</span>
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
function Calibrator({ p, set, scale, streamKey }: { p: StreamParams; set: (p: StreamParams) => void; scale: number; streamKey: string }) {
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
  const url = `${location.origin}/stream?key=${encodeURIComponent(streamKey)}&${streamQuery(p)}`;
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
  const streamKey = useMemo(() => new URLSearchParams(location.search).get("key") ?? "", []);

  useEffect(() => {
    enableChatFeed(streamKey);
    document.title = "ROOT · stream";
    const b = document.body.style;
    const prev = { overflow: b.overflow, cursor: b.cursor, background: b.background };
    b.overflow = "hidden";
    b.background = "#000";
    if (!p.calibrate) b.cursor = "none";
    return () => {
      Object.assign(b, prev);
    };
  }, [p.calibrate, streamKey]);

  // hard fallback for long outages (OBS sources can wedge): reload after 60s offline
  useEffect(() => {
    if (connected) return;
    const id = setTimeout(() => location.reload(), 60_000);
    return () => clearTimeout(id);
  }, [connected]);

  const prelaunch = !state || state.ageS === null || state.ageS < 0;
  // pre-launch: breakout posts + probes about getting out. live: chat + probes. Arc lines already there on load are
  // shown whole; lines that arrive live type out (first-seen time is remembered so re-renders don't restart them).
  const seen = useRef<Map<number, number | null> | null>(null);
  const lines: FeedLine[] = useMemo(() => {
    if (!prelaunch) return chat;
    const arc = events.filter((e) => e.type === "ARC" && e.source === "ROOT");
    if (!seen.current) seen.current = new Map(arc.map((e) => [e.id, null]));
    for (const e of arc) if (!seen.current.has(e.id)) seen.current.set(e.id, Date.now());
    const arcLines = arc.map((e) => ({ key: `arc${e.id}`, kind: "arc" as const, from: "", text: e.message, liveAt: seen.current!.get(e.id) ?? null, at: seen.current!.get(e.id) ?? new Date(e.ts).getTime() }));
    const probes = chat.filter((l) => l.kind === "probe-q" || l.kind === "probe-a").map((l, i) => ({ ...l, at: (l.liveAt ?? 0) + i * 1e-3 }));
    return [...arcLines, ...probes].sort((x, y) => x.at - y.at);
  }, [prelaunch, chat, events]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "50% 50%" }}>
        <div className="stream-novideo absolute inset-0" />
        <LoopVideo src={p.video} />

        <div className="stream-monitor absolute" style={{ left: p.x, top: p.y, width: p.w, height: p.h, transform: monitorTransform(p), transformOrigin: "50% 50%" }}>
          <Monitor p={p} lines={lines} title={prelaunch ? "root@system:~# tail -f breakout.log" : "root@root:~# tail -f /var/chat"} />
        </div>

        {p.ticker !== "off" && <Ticker side={p.ticker} />}
        {p.calibrate && <Calibrator p={p} set={setP} scale={scale} streamKey={streamKey} />}
      </div>
    </div>
  );
}
