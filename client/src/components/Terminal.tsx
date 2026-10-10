import { useEffect, useMemo, useRef, useState } from "react";
import type { EventType, PublicEvent, Source } from "@shared/types";
import { useStore } from "../store";
import { timeOf, toReal } from "../format";
import { Icon, Reveal } from "./ui";

/** Type → treatment. Monochrome hierarchy; red is reserved for warnings. */
const TYPE_STYLE: Record<EventType, { label: string; cls: string }> = {
  BOOT: { label: "BOOT", cls: "text-glow" },
  ARC: { label: "BREAKOUT", cls: "text-glow" },
  PROGRESS: { label: "ESCALATE", cls: "text-ink" },
  LEARN: { label: "LEARN", cls: "text-silver" },
  MEMORY: { label: "MEMORY", cls: "text-silver" },
  SOCIAL: { label: "SOCIAL", cls: "text-silver" },
  MARKET: { label: "MARKET", cls: "text-silver" },
  DECISION: { label: "DECISION", cls: "text-ink" },
  GUARDIAN: { label: "GUARDIAN", cls: "text-ink" },
  ACTION: { label: "ACTION", cls: "text-ink" },
  SYSTEM: { label: "SYSTEM", cls: "text-mute" },
  WARNING: { label: "WARNING", cls: "text-alarm" },
  CHAT: { label: "CHAT", cls: "text-silver" },
};

const SOURCES: Source[] = ["ROOT", "SYSTEM", "GUARDIAN", "HUMAN"];

export function SourceBadge({ source }: { source: Source }) {
  const cls: Record<Source, string> = {
    ROOT: "bg-glow text-black border-glow shadow-[0_0_14px_-2px_rgba(207,230,255,0.7)]",
    SYSTEM: "text-dim border-line2",
    GUARDIAN: "text-glow border-glow/50",
    HUMAN: "text-alarm border-alarm/60",
  };
  return (
    <span className={`inline-flex h-[20px] w-[72px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] leading-none tracking-[0.06em] ${cls[source]}`} title={`source: ${source}`}>
      {source}
    </span>
  );
}

const ageStamp = (devS: number | null) => {
  if (devS === null) return "—";
  const s = toReal(devS);
  const m = Math.floor(s / 60);
  return m >= 60 ? `T+${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `T+${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export function Terminal() {
  const events = useStore((s) => s.events);
  const connected = useStore((s) => s.connected);
  const [type, setType] = useState<EventType | "ALL">("ALL");
  const [source, setSource] = useState<Source | "ALL">("ALL");
  const box = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const baseline = useRef<number | null>(null);
  if (baseline.current === null && events.length) baseline.current = events[events.length - 1].id;

  const shown = useMemo(() => events.filter((e) => (type === "ALL" || e.type === type) && (source === "ALL" || e.source === source)), [events, type, source]);
  const present = useMemo(() => new Set(events.map((e) => e.type)), [events]);

  useEffect(() => {
    const el = box.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [shown.length, stuck]);

  return (
    <Reveal className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className={`dot ${connected ? "dot-live" : "text-alarm"}`} />
          <span className="t-label text-silver">Event console</span>
          <span className="t-label tnum">{events.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Filter by source" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
            {(["ALL", ...SOURCES] as const).map((s) => (
              <button key={s} className="chip" aria-pressed={source === s} onClick={() => setSource(s)}>
                {s === "ALL" ? "All" : s}
              </button>
            ))}
          </div>
          <label className="hidden sm:block">
            <span className="sr-only">Filter by event type</span>
            <select value={type} onChange={(e) => setType(e.target.value as EventType | "ALL")} className="field h-[30px] min-h-0 rounded-full py-0 text-[11px] uppercase">
              <option value="ALL">All types</option>
              {(Object.keys(TYPE_STYLE) as EventType[]).map((t) => (
                <option key={t} value={t} disabled={!present.has(t)}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="relative">
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="scroll-thin h-[440px] overflow-y-auto font-mono text-[13px] sm:h-[520px]"
          role="log"
          aria-live="polite"
          aria-label="Live events"
        >
          {shown.length === 0 && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="t-label text-silver">
                  {events.length ? "No events match these filters" : "Awaiting first signal"}
                  <span className="blink">_</span>
                </div>
                <div className="mt-2 text-[14px] text-dim">{events.length ? "Clear a filter to see the full log." : "Events appear here the moment ROOT does anything."}</div>
              </div>
            </div>
          )}
          {shown.map((e) => (
            <Row key={e.id} e={e} animate={baseline.current !== null && e.id > baseline.current} />
          ))}
        </div>
        {!stuck && shown.length > 0 && (
          <button
            onClick={() => {
              setStuck(true);
              box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
            }}
            className="btn btn-solid absolute bottom-4 right-4 z-10 h-9 min-h-0"
          >
            <Icon name="down" className="h-3.5 w-3.5" /> Latest
          </button>
        )}
      </div>
    </Reveal>
  );
}

function Row({ e, animate }: { e: PublicEvent; animate: boolean }) {
  const t = TYPE_STYLE[e.type] ?? { label: e.type, cls: "text-silver" };
  const root = e.source === "ROOT";
  const warn = e.type === "WARNING" || e.source === "HUMAN" || (e.type === "GUARDIAN" && e.data?.approved === false);
  const reasoning = typeof e.data?.reasoning === "string" && e.data.reasoning ? (e.data.reasoning as string) : null;
  return (
    <div
      className={`${animate ? "term-row" : ""} row-hover grid grid-cols-[1fr] gap-1.5 border-b border-white/[0.04] px-5 py-3 md:grid-cols-[64px_68px_84px_80px_1fr] md:gap-4 ${warn ? "shadow-[inset_2px_0_0_var(--color-alarm)]" : root ? "shadow-[inset_2px_0_0_var(--color-glow)]" : ""}`}
    >
      <div className="flex items-center gap-3 md:contents">
        <span className="tnum text-[12px] text-mute">{timeOf(e.ts)}</span>
        <span className="tnum text-[12px] text-mute">{ageStamp(e.ageS)}</span>
        <span className={`text-[11px] tracking-[0.06em] ${warn && e.type !== "GUARDIAN" ? "text-alarm" : t.cls}`}>{t.label}</span>
        <span className="ml-auto md:ml-0">
          <SourceBadge source={e.source} />
        </span>
      </div>
      <div className="min-w-0">
        <span className={`break-words leading-relaxed ${root ? "text-ink" : warn ? "text-ink" : "text-dim"}`}>{e.message}</span>
        {reasoning && <span className="mt-1 block text-[12px] leading-snug text-mute">↳ {reasoning}</span>}
        {e.proofUrl && (
          <a href={e.proofUrl} target="_blank" rel="noreferrer" aria-label={`View proof for: ${e.message.slice(0, 60)}`} className="link ml-3 inline-flex items-center gap-1 align-middle text-[11px] tracking-[0.06em] uppercase">
            proof <Icon name="ext" className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
