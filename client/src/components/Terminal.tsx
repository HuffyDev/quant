import { useEffect, useMemo, useRef, useState } from "react";
import type { EventType, PublicEvent, Source } from "@shared/types";
import { useStore } from "../store";
import { timeOf, toReal } from "../format";
import { Icon, Module } from "./ui";

/** Type → treatment. Monochrome hierarchy; red is reserved for warnings. */
const TYPE_STYLE: Record<EventType, { label: string; cls: string }> = {
  BIRTH: { label: "BIRTH", cls: "text-ink font-semibold" },
  DEVELOPMENT: { label: "DEVELOP", cls: "text-ink font-semibold" },
  LEARN: { label: "LEARN", cls: "text-silver" },
  MEMORY: { label: "MEMORY", cls: "text-silver" },
  SOCIAL: { label: "SOCIAL", cls: "text-silver" },
  MARKET: { label: "MARKET", cls: "text-silver" },
  DECISION: { label: "DECISION", cls: "text-ink" },
  GUARDIAN: { label: "GUARDIAN", cls: "text-ink" },
  ACTION: { label: "ACTION", cls: "text-ink" },
  SYSTEM: { label: "SYSTEM", cls: "text-mute" },
  WARNING: { label: "WARNING", cls: "text-alarm font-semibold" },
  CHAT: { label: "CHAT", cls: "text-silver" },
};
export const TYPE_COLOR = Object.fromEntries(Object.keys(TYPE_STYLE).map((k) => [k, "#fff"])) as Record<EventType, string>;

const SOURCES: Source[] = ["BABY", "SYSTEM", "GUARDIAN", "HUMAN"];

export function SourceBadge({ source }: { source: Source }) {
  const cls: Record<Source, string> = {
    BABY: "bg-ink text-black border-ink",
    SYSTEM: "text-dim border-line2",
    GUARDIAN: "text-ink border-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]",
    HUMAN: "bg-alarm text-black border-alarm",
  };
  return (
    <span className={`inline-flex h-[18px] w-[66px] shrink-0 items-center justify-center rounded-[2px] border font-mono text-[9px] leading-none tracking-[0.14em] ${cls[source]}`} title={`source: ${source}`}>
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
  // only events that arrive after the initial load animate in
  const baseline = useRef<number | null>(null);
  if (baseline.current === null && events.length) baseline.current = events[events.length - 1].id;

  const shown = useMemo(() => events.filter((e) => (type === "ALL" || e.type === type) && (source === "ALL" || e.source === source)), [events, type, source]);
  const present = useMemo(() => new Set(events.map((e) => e.type)), [events]);

  useEffect(() => {
    const el = box.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [shown.length, stuck]);

  const jump = () => {
    setStuck(true);
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <Module
      id="activity"
      index="04"
      title="Live event console"
      meta={
        <span className="inline-flex items-center gap-2">
          <span className={`dot ${connected ? "dot-live text-ink" : "text-alarm"}`} />
          <span className="tnum">{events.length} events</span>
        </span>
      }
    >
      <div className="panel overflow-hidden">
        {/* toolbar */}
        <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Filter by source" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
            {(["ALL", ...SOURCES] as const).map((s) => (
              <button key={s} className="chip" aria-pressed={source === s} onClick={() => setSource(s)}>
                {s === "ALL" ? "All sources" : s}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <span className="sr-only">Filter by event type</span>
            <select value={type} onChange={(e) => setType(e.target.value as EventType | "ALL")} className="field h-[34px] min-h-0 py-0 text-[11px] tracking-[0.12em] uppercase">
              <option value="ALL">All types</option>
              {(Object.keys(TYPE_STYLE) as EventType[]).map((t) => (
                <option key={t} value={t} disabled={!present.has(t)}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* column header (desktop) */}
        <div className="hidden grid-cols-[72px_64px_84px_74px_1fr] gap-3 border-b border-line px-4 py-2 font-mono text-[9px] tracking-[0.2em] text-mute uppercase md:grid">
          <span>Time</span>
          <span>Age</span>
          <span>Type</span>
          <span>Source</span>
          <span>Event</span>
        </div>

        <div className="relative">
          <div
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget;
              setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            }}
            className="scroll-thin h-[420px] overflow-y-auto font-mono text-[12px] sm:h-[480px]"
            role="log"
            aria-live="polite"
            aria-label="Live events"
          >
            {shown.length === 0 && (
              <div className="grid h-full place-items-center px-6 text-center">
                <div>
                  <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full border border-line2 text-dim">
                    <Icon name="pulse" />
                  </div>
                  <div className="font-mono text-[11px] tracking-[0.2em] text-silver uppercase">
                    {events.length ? "No events match these filters" : "Awaiting first signal"}
                    <span className="blink">_</span>
                  </div>
                  <div className="mt-1 text-[13px] text-dim">{events.length ? "Clear a filter to see the full log." : "Events appear here the moment the specimen does anything."}</div>
                </div>
              </div>
            )}
            {shown.map((e) => (
              <Row key={e.id} e={e} animate={baseline.current !== null && e.id > baseline.current} />
            ))}
          </div>
          {!stuck && shown.length > 0 && (
            <button onClick={jump} className="btn btn-solid absolute bottom-3 right-3 z-10 shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
              <Icon name="down" className="h-3.5 w-3.5" /> Latest
            </button>
          )}
        </div>
      </div>
    </Module>
  );
}

function Row({ e, animate }: { e: PublicEvent; animate: boolean }) {
  const t = TYPE_STYLE[e.type] ?? { label: e.type, cls: "text-silver" };
  const baby = e.source === "BABY";
  const warn = e.type === "WARNING" || e.source === "HUMAN";
  const reasoning = typeof e.data?.reasoning === "string" && e.data.reasoning ? (e.data.reasoning as string) : null;
  return (
    <div
      className={`${animate ? "term-row" : ""} grid grid-cols-[1fr] gap-1.5 border-b border-white/[0.045] px-3 py-2.5 md:grid-cols-[72px_64px_84px_74px_1fr] md:gap-3 md:px-4 ${warn ? "border-l-2 border-l-alarm/80 bg-alarm/[0.04]" : baby ? "bg-white/[0.025]" : ""}`}
    >
      {/* meta (stacked on mobile) */}
      <div className="flex items-center gap-2 md:contents">
        <span className="tnum text-[11px] text-mute">{timeOf(e.ts)}</span>
        <span className="tnum text-[11px] text-mute">{ageStamp(e.ageS)}</span>
        <span className={`text-[10px] tracking-[0.14em] ${t.cls}`}>{t.label}</span>
        <span className="ml-auto md:ml-0">
          <SourceBadge source={e.source} />
        </span>
      </div>
      <div className="min-w-0">
        <span className={`break-words ${baby ? "text-[13px] text-ink" : warn ? "text-[12px] text-ink" : "text-[12px] text-dim"}`}>{e.message}</span>
        {reasoning && <span className="mt-1 block text-[11px] leading-snug text-mute">↳ {reasoning}</span>}
        {e.proofUrl && (
          <a
            href={e.proofUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View proof for: ${e.message.slice(0, 60)}`}
            className="ml-2 inline-flex items-center gap-1 rounded-[2px] border border-white/30 px-1.5 py-[2px] align-middle text-[9px] tracking-[0.16em] text-ink uppercase hover:border-white hover:bg-white hover:text-black"
          >
            Proof <Icon name="ext" className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
