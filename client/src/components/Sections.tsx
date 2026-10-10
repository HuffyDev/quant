import { useState } from "react";
import type { AnatomyPart } from "@shared/types";
import { useStore } from "../store";
import { useAge, realSeconds } from "../hooks";
import { fmtAgeShort, fmtCountdown, fmtSol, fmtT, fmtUsd, shortSig, stepPace, timeOf } from "../format";
import { stageIcon } from "./stageIcons";
import { EmptyState, Icon, Module, StatusTag } from "./ui";

// stable fallback: a fresh [] per call would loop useSyncExternalStore
const EMPTY: never[] = [];

function More({ total, shown, onClick }: { total: number; shown: number; onClick: () => void }) {
  if (total <= shown) return null;
  return (
    <button onClick={onClick} className="btn mt-3 w-full sm:w-auto">
      Show all {total} <Icon name="down" className="h-3.5 w-3.5" />
    </button>
  );
}

const Container = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-10 ${className}`}>{children}</div>
);
export { Container };

function ProofLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="inline-flex min-h-[30px] items-center gap-1.5 rounded-[2px] border border-white/30 px-2.5 font-mono text-[10px] tracking-[0.16em] text-ink uppercase transition hover:border-white hover:bg-white hover:text-black"
    >
      Proof <Icon name="ext" className="h-3 w-3" />
    </a>
  );
}

// ── 02. Development ─────────────────────────────────────────────────────────
export function DevBars() {
  const bars = useStore((s) => s.state?.bars ?? EMPTY);
  const SEGS = 24;
  return (
    <Module index="02" title="Development" meta="Computed from live state">
      <div className="grid gap-px overflow-hidden rounded-[3px] border border-line bg-line md:grid-cols-2">
        {bars.map((b) => {
          const on = Math.round(b.value * SEGS);
          return (
            <div key={b.key} className="bg-base px-4 py-4 md:last:odd:col-span-2">
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <span className="font-mono text-[11px] tracking-[0.2em] text-ink uppercase">{b.label}</span>
                <span className="tnum font-mono text-xl text-ink">
                  {Math.round(b.value * 100)}
                  <span className="text-[10px] text-dim">%</span>
                </span>
              </div>
              <div className="flex gap-[3px]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.value * 100)} aria-label={b.label}>
                {Array.from({ length: SEGS }, (_, i) => (
                  <span key={i} className={`seg ${i < on ? "on" : ""}`} style={{ transitionDelay: `${i * 25}ms` }} />
                ))}
              </div>
              <div className="mt-2 font-mono text-[11px] text-dim">{b.detail}</div>
            </div>
          );
        })}
      </div>
    </Module>
  );
}

// ── 03. Anatomy ─────────────────────────────────────────────────────────────
const ANATOMY_ICON: Record<string, Parameters<typeof Icon>[0]["name"]> = {
  eyes: "eye", ears: "ear", memory: "memory", brain: "brain", voice: "voice", hands: "hand", guardian: "shield", nervous: "nerve",
};

export function Anatomy() {
  const { age, state } = useAge(1000);
  if (!state) return null;
  return (
    <Module index="03" title="Anatomy" meta={`${state.anatomy.filter((a) => a.active).length}/${state.anatomy.length} organs active`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {state.anatomy.map((a) => (
          <Organ key={a.key} a={a} until={a.unlockAt !== null && age !== null ? realSeconds(a.unlockAt - Math.max(0, age), state.simSpeed) : null} caps={state.capabilities} />
        ))}
      </div>
    </Module>
  );
}

function Organ({ a, until, caps }: { a: AnatomyPart; until: number | null; caps: Record<string, boolean> }) {
  const partial = !a.active && !!a.partial;
  return (
    <div className={`panel relative overflow-hidden px-4 py-4 transition ${a.active ? "border-white/35 shadow-[0_0_40px_-18px_rgba(255,255,255,0.5)]" : partial ? "border-white/20" : "stripes"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`grid h-9 w-9 place-items-center rounded-full border ${a.active ? "border-white/70 text-ink" : "border-line2 text-mute"}`}>
          <Icon name={ANATOMY_ICON[a.key] ?? "pulse"} className="h-[18px] w-[18px]" />
        </div>
        {a.active ? <StatusTag tone="on">Online</StatusTag> : partial ? <StatusTag tone="partial">Partial</StatusTag> : <StatusTag tone="off"><Icon name="lock" className="h-2.5 w-2.5" />Locked</StatusTag>}
      </div>
      <div className="mt-3 font-display text-[15px] font-semibold tracking-tight text-ink uppercase" style={{ fontStretch: "112%" }}>
        {a.label}
      </div>
      <div className="tnum mt-0.5 h-4 font-mono text-[11px] text-dim">
        {!a.active && until !== null && until > 0 ? `${partial ? "next in" : "unlocks in"} ${fmtCountdown(until)}` : a.active ? "all systems online" : ""}
      </div>
      {a.capabilities.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {a.capabilities.map((c) => (
            <span key={c} className={`rounded-[2px] border px-1.5 py-[2px] font-mono text-[9px] tracking-[0.06em] ${caps[c] ? "border-white/30 text-silver" : "border-line text-mute"}`}>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 06. Action log ──────────────────────────────────────────────────────────
export function ActionLog() {
  const all = useStore((s) => s.state?.actions ?? EMPTY);
  const [n, setN] = useState(12);
  const actions = all.slice(0, n);
  return (
    <Module id="actions" index="06" title="Action log" meta="Every row links to proof">
      {all.length === 0 ? (
        <EmptyState title="No actions yet" detail="Posts, replies and buybacks land here, each with an on-chain or on-X proof link." />
      ) : (
        <div className="panel divide-y divide-white/[0.06] overflow-hidden">
          {actions.map((a) => {
            const link = a.proofUrl ?? a.xUrl;
            const tone = a.status === "CONFIRMED" ? "on" : a.status === "FAILED" ? "alarm" : "warn";
            const icon = a.type === "BUYBACK" ? "bolt" : a.type === "X_REPLY" ? "chat" : "send";
            return (
              <div key={a.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
                <div className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-silver">
                  <Icon name={icon} className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] tracking-[0.16em] text-ink uppercase">{a.type.replace("_", " ")}</span>
                    {a.amountSol !== null && <span className="tnum font-mono text-[12px] text-ink">{fmtSol(a.amountSol)}</span>}
                    <StatusTag tone={tone}>{a.status}</StatusTag>
                    <span className="tnum font-mono text-[10px] text-mute">{timeOf(a.ts)}</span>
                  </div>
                  {a.summary && <div className="mt-1 truncate text-[13px] text-dim">{a.summary}</div>}
                </div>
                {link ? <ProofLink href={link} label={`Proof for ${a.type} ${a.txSig ? shortSig(a.txSig, 4) : ""}`} /> : <span className="font-mono text-[10px] text-mute">—</span>}
              </div>
            );
          })}
        </div>
      )}
      <More total={all.length} shown={n} onClick={() => setN(1000)} />
    </Module>
  );
}

// ── 07. Proposals ───────────────────────────────────────────────────────────
export function Proposals() {
  const all = useStore((s) => s.state?.proposals ?? EMPTY);
  const [n, setN] = useState(6);
  const proposals = all.slice(0, n);
  return (
    <Module index="07" title="Proposals · Guardian" meta="Deterministic risk engine">
      {all.length === 0 ? (
        <EmptyState locked title="Decision making locked" detail="Structured proposals begin at T+22:00. The Guardian rules on every one, publicly." />
      ) : (
        <div className="grid gap-3">
          {proposals.map((p) => {
            const rejected = p.status === "REJECTED" || p.status === "FAILED";
            const pending = p.status === "PENDING";
            return (
              <article key={p.id} className="panel panel-ticks overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="flex items-baseline gap-3">
                    <span className="tnum font-mono text-[11px] text-mute">#{String(p.id).padStart(3, "0")}</span>
                    <span className="font-mono text-[12px] tracking-[0.14em] text-ink uppercase">{p.type}</span>
                    <span className="tnum font-mono text-lg text-ink">{fmtSol(p.amount)}</span>
                  </div>
                  <StatusTag tone={rejected ? "alarm" : pending ? "warn" : "on"}>{p.status}</StatusTag>
                </div>
                <div className="grid gap-4 px-4 py-3 sm:grid-cols-[1fr_160px]">
                  <ul className="space-y-1 text-[13px] text-silver">
                    {p.reasons.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-mute">—</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <div className="eyebrow mb-1.5">Confidence</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${Math.round(p.confidence * 100)}%` }} />
                    </div>
                    <div className="tnum mt-1 font-mono text-[11px] text-ink">{Math.round(p.confidence * 100)}%</div>
                  </div>
                </div>
                {p.guardianResult && (
                  <div className={`flex items-start gap-3 border-t px-4 py-3 ${rejected ? "border-alarm/30 bg-alarm/[0.05]" : "border-line bg-white/[0.02]"}`}>
                    <Icon name="shield" className={`mt-0.5 h-4 w-4 shrink-0 ${rejected ? "text-alarm" : "text-ink"}`} />
                    <div className="min-w-0 text-[13px]">
                      <span className={`font-mono text-[11px] tracking-[0.16em] uppercase ${rejected ? "text-alarm" : "text-ink"}`}>Guardian {p.guardianResult}</span>
                      <span className="text-dim"> — {p.guardianReason}</span>
                      {p.maxAllowed !== null && p.guardianResult === "REJECTED" && <span className="tnum block font-mono text-[11px] text-silver">max allowed now {fmtSol(p.maxAllowed)}</span>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <More total={all.length} shown={n} onClick={() => setN(1000)} />
    </Module>
  );
}

// ── 08. Timeline ────────────────────────────────────────────────────────────
export function Timeline() {
  const { age, state } = useAge(1000);
  const [showAll, setShowAll] = useState(false);
  if (!state) return null;
  const hour = state.timeline.filter((s) => s.t <= 3600);
  const days = state.timeline.filter((s) => s.t > 3600);
  // collapsed view: the latest fired steps plus what's coming next
  const lastFired = hour.reduce((m, s, i) => (s.fired ? i : m), -1);
  const visibleHour = showAll ? hour : hour.filter((_, i) => (lastFired < 0 ? i < 4 : i >= lastFired - 5 && i <= lastFired + 4));
  const nextId = hour.find((s) => !s.fired)?.id;
  const done = hour.filter((s) => s.fired).length;

  return (
    <Module index="08" title="Development timeline" meta={`${done}/${hour.length} first-hour steps · one every ~${stepPace()}`}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="panel px-2 py-2 sm:px-3">
          <ol className="relative">
            {visibleHour.map((s, i) => {
              const until = age !== null ? realSeconds(s.t - Math.max(0, age), state.simSpeed) : null;
              const isNext = s.id === nextId;
              const last = i === visibleHour.length - 1;
              return (
                <li key={s.id} className="relative grid grid-cols-[52px_24px_1fr] gap-2 rounded-[2px] px-2 py-2.5 sm:grid-cols-[64px_24px_1fr_auto] sm:gap-3">
                  <span className="tnum pt-0.5 font-mono text-[11px] text-mute">{fmtT(s.t)}</span>
                  <span className="relative flex justify-center">
                    {!last && <span className={`absolute top-4 bottom-[-22px] w-px ${s.fired ? "bg-white/40" : "bg-white/10"}`} />}
                    <span
                      className={`relative z-10 mt-1 h-2.5 w-2.5 rounded-full border ${s.fired ? (s.skipped ? "border-white/60 bg-transparent" : "border-white bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]") : isNext ? "dot-live border-white bg-black" : "border-white/25 bg-black"}`}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className={`font-mono text-[12px] tracking-[0.12em] uppercase ${s.fired ? "text-ink" : isNext ? "text-ink" : "text-dim"}`}>
                      {s.label}
                      {s.skipped && <span className="ml-2 text-[10px] text-mute">skipped</span>}
                      {isNext && <span className="ml-2 text-[10px] text-silver">· next</span>}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-mute">{s.description}</span>
                    {s.unlocks.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {s.unlocks.map((c) => (
                          <span key={c} className={`rounded-[2px] border px-1.5 py-[1px] font-mono text-[9px] ${s.fired ? "border-white/30 text-silver" : "border-line text-mute"}`}>
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="tnum col-start-3 font-mono text-[11px] text-dim sm:col-start-auto sm:pt-0.5 sm:text-right">
                    {s.fired ? <Icon name="check" className="inline h-3.5 w-3.5 text-ink" /> : until !== null && until > 0 ? fmtCountdown(until) : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          {!showAll && hour.length > visibleHour.length && (
            <button onClick={() => setShowAll(true)} className="btn m-2">
              Show full first hour <Icon name="down" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div>
          <div className="eyebrow mb-3">Locked development · beyond hour one</div>
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {days.map((s) => {
              const until = age !== null ? realSeconds(s.t - Math.max(0, age), state.simSpeed) : null;
              return (
                <li key={s.id} className="panel stripes flex items-center gap-3 px-3 py-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[2px] border border-line bg-black">
                    <img src={stageIcon(s.stage)} alt="" className="screen h-10 w-10 object-contain opacity-60" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="tnum font-mono text-[10px] text-mute">{fmtT(s.t)}</span>
                      <span className="truncate font-mono text-[12px] tracking-[0.12em] text-ink uppercase">{s.label}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] leading-snug text-mute">{s.description}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusTag tone="off">
                      <Icon name="lock" className="h-2.5 w-2.5" />
                      Locked
                    </StatusTag>
                    <div className="tnum mt-1.5 font-mono text-[11px] text-silver">{until !== null && until > 0 ? fmtCountdown(until) : s.wired ? "" : "awaiting wiring"}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Module>
  );
}

// ── 09–10. Memories + People ────────────────────────────────────────────────
export function MemoriesPeople() {
  const memories = useStore((s) => s.state?.memories ?? EMPTY);
  const allPeople = useStore((s) => s.state?.people ?? EMPTY);
  const slang = useStore((s) => s.state?.slang ?? EMPTY);
  const [pn, setPn] = useState(15);
  const people = allPeople.slice(0, pn);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
      <Module id="memories" index="09" title="Memories" meta={`${memories.length} stored`}>
        {memories.length === 0 ? (
          <EmptyState locked title="Long-term memory offline" detail="Memory comes online at T+14:00 and backfills its first minutes." />
        ) : (
          <div className="panel scroll-thin max-h-[440px] divide-y divide-white/[0.06] overflow-y-auto">
            {memories.map((m) => (
              <div key={m.id} className="px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-[2px] border border-white/30 px-1.5 py-[1px] font-mono text-[9px] tracking-[0.14em] text-silver uppercase">{m.kind}</span>
                  <span className="tnum font-mono text-[10px] text-mute">formed {fmtAgeShort(m.ageS).replace(" old", "")}</span>
                  {m.userHandle && <span className="font-mono text-[10px] text-dim">@{m.userHandle}</span>}
                </div>
                <div className="text-[14px] leading-snug text-ink">{m.content}</div>
                {m.tags.length > 0 && <div className="mt-1 font-mono text-[10px] text-mute">{m.tags.map((t) => `#${t}`).join(" ")}</div>}
              </div>
            ))}
          </div>
        )}
        <div className="mt-5">
          <div className="eyebrow mb-2">Words learned · {slang.length}</div>
          {slang.length === 0 ? (
            <div className="font-mono text-[12px] text-mute">No words yet. Language unlocks at T+16:00.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slang.map((w) => (
                <span key={w.term} title={w.definition} className="rounded-[2px] border border-line2 px-2 py-1 font-mono text-[11px] text-ink">
                  {w.term}
                  <span className="ml-1.5 text-mute">{fmtAgeShort(w.learnedAtAgeS).replace(" old", "")}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Module>

      <Module id="people" index="10" title="People I know" meta={`${allPeople.length} recognised`}>
        {allPeople.length === 0 ? (
          <EmptyState locked title="Recognition offline" detail="From T+14:00 it remembers who talked to it, and when." />
        ) : (
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.2fr_90px_100px_1.6fr] gap-3 border-b border-line px-4 py-2 font-mono text-[9px] tracking-[0.2em] text-mute uppercase sm:grid">
              <span>Handle</span>
              <span>Interactions</span>
              <span>First met</span>
              <span>Relationship</span>
            </div>
            <ul className="divide-y divide-white/[0.06]">
              {people.map((p) => (
                <li key={`${p.platform}:${p.handle}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[1.2fr_90px_100px_1.6fr] sm:items-center sm:gap-3">
                  <span className="min-w-0 truncate font-mono text-[13px] text-ink">
                    @{p.handle} <span className="text-[10px] tracking-[0.14em] text-mute uppercase">{p.platform}</span>
                  </span>
                  <span className="tnum font-mono text-[12px] text-silver">
                    {p.interactions}
                    <span className="text-mute sm:hidden"> interactions</span>
                  </span>
                  <span className="tnum font-mono text-[12px] text-dim">
                    <span className="sm:hidden">first met </span>at {fmtAgeShort(p.firstSeenAgeS).replace(" old", "")}
                  </span>
                  <span className="text-[13px] text-dim">{p.relationshipSummary ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <More total={allPeople.length} shown={pn} onClick={() => setPn(1000)} />
      </Module>
    </div>
  );
}

// ── 11. Vital signs ─────────────────────────────────────────────────────────
export function Vitals() {
  const { age, state } = useAge(1000);
  if (!state) return null;
  const v = state.vitals;
  const items: [string, string, string?][] = [
    ["Age", fmtAgeShort(age !== null && age >= 0 ? age : null).replace(" old", "")],
    ["Market cap", fmtUsd(v.mcapUsd)],
    ["Liquidity", fmtUsd(v.liquidityUsd)],
    ["Holders", v.holders?.toLocaleString() ?? "—"],
    ["Treasury", v.treasurySol !== null ? v.treasurySol.toFixed(3) : "—", "SOL"],
    ["Mentions", v.mentions.toLocaleString()],
    ["Memories", v.memories.toLocaleString()],
    ["Words learned", v.wordsLearned.toLocaleString()],
  ];
  return (
    <Module id="treasury" index="11" title="Vital signs">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-4">
        {items.map(([k, val, unit]) => (
          <div key={k} className="bg-base px-4 py-4">
            <div className="eyebrow">{k}</div>
            <div className="tnum mt-2 truncate font-mono text-[clamp(1.1rem,2.4vw,1.6rem)] text-ink">
              {val}
              {unit && <span className="ml-1 text-[10px] tracking-[0.16em] text-dim">{unit}</span>}
            </div>
          </div>
        ))}
      </div>
    </Module>
  );
}

// ── 12. Token ───────────────────────────────────────────────────────────────
export function Token() {
  const token = useStore((s) => s.state?.token);
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  const ca = token.mint;
  return (
    <Module id="token" index="12" title="Token" meta={token.symbol ? `$${token.symbol}` : undefined}>
      <div className="panel panel-ticks flex flex-col gap-5 px-4 py-5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-2">Contract address</div>
          <div className="break-all font-mono text-[13px] text-ink sm:text-[15px]">{ca ?? "Revealed at birth"}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={!ca}
            aria-live="polite"
            onClick={() => {
              if (!ca) return;
              navigator.clipboard?.writeText(ca).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="btn btn-solid"
          >
            <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy CA"}
          </button>
          {token.xHandle && <Ext href={`https://x.com/${token.xHandle}`}>X</Ext>}
          {ca && <Ext href={`https://dexscreener.com/solana/${ca}`}>DexScreener</Ext>}
          {ca && <Ext href={`https://pump.fun/coin/${ca}`}>pump.fun</Ext>}
          {ca && <Ext href={`https://solscan.io/token/${ca}`}>Solscan</Ext>}
        </div>
      </div>
    </Module>
  );
}

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="btn">
    {children} <Icon name="ext" className="h-3 w-3" />
  </a>
);
