import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useAge, realSeconds } from "../hooks";
import { fmtAgeShort, fmtCountdown, fmtSol, fmtT, fmtUsd, shortSig, timeOf } from "../format";
import { CountUp, EmptyState, Icon, Module, PanelHead, Reveal, StatusTag } from "./ui";

// stable fallback: a fresh [] per call would loop useSyncExternalStore
const EMPTY: never[] = [];

function More({ total, shown, onClick }: { total: number; shown: number; onClick: () => void }) {
  if (total <= shown) return null;
  return (
    <button onClick={onClick} className="btn mt-4">
      Show all {total} <Icon name="down" className="h-3.5 w-3.5" />
    </button>
  );
}

function ProofLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="btn h-8 min-h-0 px-3 text-[11px]">
      Proof <Icon name="ext" className="h-3 w-3" />
    </a>
  );
}

// ── Action log (inside 01 Activity) ─────────────────────────────────────────
export function ActionLog() {
  const all = useStore((s) => s.state?.actions ?? EMPTY);
  const [n, setN] = useState(8);
  const actions = all.slice(0, n);
  return (
    <Reveal className="panel overflow-hidden">
      <div id="actions" />
      <PanelHead title="Action log" meta="every row links to proof" />
      {all.length === 0 ? (
        <div className="px-5 py-8 text-[14px] text-dim">Posts, replies and buybacks land here, each with an on-chain or on-X proof link.</div>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {actions.map((a) => {
            const link = a.proofUrl ?? a.xUrl;
            const tone = a.status === "CONFIRMED" ? "on" : a.status === "FAILED" ? "alarm" : "warn";
            const icon = a.type === "BUYBACK" ? "bolt" : a.type === "X_REPLY" ? "chat" : "send";
            return (
              <li key={a.id} className="row-hover grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3.5">
                <span className={`grid h-9 w-9 place-items-center rounded-full border ${a.type === "BUYBACK" ? "border-glow/40 text-glow" : "border-line2 text-silver"}`}>
                  <Icon name={icon} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-[12px] tracking-[0.04em] text-ink uppercase">{a.type.replace("_", " ")}</span>
                    {a.amountSol !== null && <span className="t-data text-[13px] text-glow">{fmtSol(a.amountSol)}</span>}
                    <StatusTag tone={tone}>{a.status}</StatusTag>
                    <span className="t-data text-[12px] text-mute">{timeOf(a.ts)}</span>
                  </div>
                  {a.summary && <div className="mt-1 truncate text-[14px] text-dim">{a.summary}</div>}
                </div>
                {link ? <ProofLink href={link} label={`Proof for ${a.type} ${a.txSig ? shortSig(a.txSig, 4) : ""}`} /> : <span className="t-label">—</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-5 pb-4">
        <More total={all.length} shown={n} onClick={() => setN(1000)} />
      </div>
    </Reveal>
  );
}

// ── 02 Treasury: readouts + proposals & Guardian ─────────────────────────────
export function Treasury() {
  const state = useStore((s) => s.state);
  const all = useStore((s) => s.state?.proposals ?? EMPTY);
  const [n, setN] = useState(5);
  if (!state) return null;
  const buybacks = state.actions.filter((a) => a.type === "BUYBACK" && a.status === "CONFIRMED");
  const spent = buybacks.reduce((s, a) => s + (a.amountSol ?? 0), 0);
  const rejected = all.filter((p) => p.status === "REJECTED").length;
  const stats: [string, React.ReactNode][] = [
    ["Treasury", <><CountUp value={state.vitals.treasurySol} format={(v) => v.toFixed(3)} /> <span className="text-[16px] text-dim">SOL</span></>],
    ["Bought back", <><CountUp value={spent} format={(v) => v.toFixed(2)} /> <span className="text-[16px] text-dim">SOL</span></>],
    ["Buybacks", <CountUp value={buybacks.length} />],
    ["Guardian rejections", <span className={rejected ? "text-alarm" : ""}><CountUp value={rejected} /></span>],
  ];
  return (
    <Module id="treasury" index="02" title="Treasury" meta="guardian-checked · buyback only">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Reveal className="grid grid-cols-2 content-start gap-px self-start overflow-hidden rounded-[10px] border border-line bg-line lg:col-span-4 lg:grid-cols-1">
          {stats.map(([k, v]) => (
            <div key={k} className="bg-black px-5 py-6">
              <div className="t-label">{k}</div>
              <div className="t-data mt-2 text-[28px] leading-none text-ink sm:text-[34px]">{v}</div>
            </div>
          ))}
        </Reveal>
        <div className="lg:col-span-8">
          {all.length === 0 ? (
            <EmptyState locked title="Decision making locked" detail="Structured proposals begin at T+22:00. The Guardian rules on every one, publicly." />
          ) : (
            <div className="grid gap-4">
              {all.slice(0, n).map((p, i) => {
                const rejected = p.status === "REJECTED" || p.status === "FAILED";
                const pending = p.status === "PENDING";
                return (
                  <Reveal key={p.id} delay={i * 40}>
                    <article className={`panel overflow-hidden ${rejected ? "border-alarm/40" : ""}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                        <div className="flex items-baseline gap-4">
                          <span className="t-data text-[12px] text-mute">#{String(p.id).padStart(3, "0")}</span>
                          <span className="t-data text-[22px] text-ink">{fmtSol(p.amount)}</span>
                          <span className="t-label">{p.type}</span>
                        </div>
                        <StatusTag tone={rejected ? "alarm" : pending ? "warn" : "on"}>{p.status}</StatusTag>
                      </div>
                      <div className="grid gap-5 border-t border-line px-5 py-4 sm:grid-cols-[1fr_180px]">
                        <ul className="space-y-1.5 text-[14px] leading-relaxed text-silver">
                          {p.reasons.map((r, j) => (
                            <li key={j} className="flex gap-3">
                              <span className="text-mute">—</span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                        <div>
                          <div className="t-label mb-2 flex justify-between">
                            <span>Confidence</span>
                            <span className="tnum text-ink">{Math.round(p.confidence * 100)}%</span>
                          </div>
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${Math.round(p.confidence * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                      {p.guardianResult && (
                        <div className={`flex items-start gap-3 border-t px-5 py-3.5 ${rejected ? "border-alarm/30 bg-alarm/[0.05]" : "border-line"}`}>
                          <Icon name="shield" className={`mt-0.5 h-4 w-4 shrink-0 ${rejected ? "text-alarm" : "text-glow"}`} />
                          <div className="min-w-0 text-[14px]">
                            <span className={`font-mono text-[12px] tracking-[0.06em] uppercase ${rejected ? "text-alarm" : "text-glow"}`}>Guardian {p.guardianResult}</span>
                            <span className="text-dim"> — {p.guardianReason}</span>
                            {p.maxAllowed !== null && p.guardianResult === "REJECTED" && <span className="t-data block text-[12px] text-silver">max allowed now {fmtSol(p.maxAllowed)}</span>}
                          </div>
                        </div>
                      )}
                    </article>
                  </Reveal>
                );
              })}
            </div>
          )}
          <More total={all.length} shown={n} onClick={() => setN(1000)} />
        </div>
      </div>
    </Module>
  );
}

// ── 03 Escalation: one horizontal rail ──────────────────────────────────────
export function Escalation() {
  const { age, state } = useAge(1000);
  const rail = useRef<HTMLOListElement>(null);
  const nextId = state?.timeline.find((s) => s.t <= 3600 && !s.fired)?.id;
  // keep the current step in view
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>(`[data-id="${nextId}"]`);
    if (el && rail.current) rail.current.scrollTo({ left: Math.max(0, el.offsetLeft - 120), behavior: "smooth" });
  }, [nextId]);
  if (!state) return null;
  const hour = state.timeline.filter((s) => s.t <= 3600);
  const days = state.timeline.filter((s) => s.t > 3600);
  const done = hour.filter((s) => s.fired).length;
  return (
    <Module id="escalation" index="03" title="Escalation" meta={`${done}/${hour.length} first-hour steps`}>
      <Reveal>
        <div className="bar-track mb-6">
          <div className="bar-fill" style={{ width: `${(done / hour.length) * 100}%` }} />
        </div>
        <ol ref={rail} className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          {hour.map((s) => {
            const until = age !== null ? realSeconds(s.t - Math.max(0, age), state.simSpeed) : null;
            const isNext = s.id === nextId;
            return (
              <li
                key={s.id}
                data-id={s.id}
                className={`panel w-[220px] shrink-0 snap-start p-4 transition-[border-color,background] duration-500 ${isNext ? "border-glow/50 bg-glow/[0.04]" : s.fired ? "" : "opacity-60"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="t-data text-[12px] text-mute">{fmtT(s.t)}</span>
                  {s.fired ? (
                    s.skipped ? (
                      <span className="t-label">skipped</span>
                    ) : (
                      <Icon name="check" className="h-3.5 w-3.5 text-glow" />
                    )
                  ) : isNext ? (
                    <span className="t-data text-[12px] text-glow">{until !== null && until > 0 ? fmtCountdown(until) : "now"}</span>
                  ) : null}
                </div>
                <div className={`mt-3 text-[15px] font-medium tracking-[-0.01em] ${s.fired || isNext ? "text-ink" : "text-silver"}`}>{s.label.toLowerCase()}</div>
                <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-dim">{s.description}</p>
                {s.unlocks.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.unlocks.map((c) => (
                      <span key={c} className={`rounded-full border px-2 py-[2px] font-mono text-[9.5px] ${s.fired ? "border-glow/30 text-glow" : "border-line text-mute"}`}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Reveal>
      <Reveal delay={80} className="mt-10">
        <div className="t-label mb-4">Beyond hour one · locked</div>
        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4 lg:grid-cols-7">
          {days.map((s) => {
            const until = age !== null ? realSeconds(s.t - Math.max(0, age), state.simSpeed) : null;
            return (
              <li key={s.id} className="bg-black p-4">
                <div className="t-data text-[12px] text-mute">{fmtT(s.t)}</div>
                <div className="mt-2 text-[14px] font-medium text-silver">{s.label.toLowerCase()}</div>
                <div className="t-data mt-3 text-[12px] text-dim">{until !== null && until > 0 ? fmtCountdown(until) : s.wired ? "" : "awaiting wiring"}</div>
              </li>
            );
          })}
        </ol>
      </Reveal>
    </Module>
  );
}

// ── 04 Mind: capability matrix + memory + contacts ──────────────────────────
export function Mind() {
  const { age, state } = useAge(1000);
  const memories = useStore((s) => s.state?.memories ?? EMPTY);
  const people = useStore((s) => s.state?.people ?? EMPTY);
  const slang = useStore((s) => s.state?.slang ?? EMPTY);
  const [tab, setTab] = useState<"memory" | "contacts" | "words">("memory");
  if (!state) return null;
  const on = Object.values(state.capabilities).filter(Boolean).length;
  const total = Object.keys(state.capabilities).length;
  return (
    <Module id="mind" index="04" title="Mind" meta={`${on}/${total} capabilities online`}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          {/* meters */}
          <div className="panel mb-6 grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
            {state.bars.map((b) => (
              <div key={b.key}>
                <div className="flex items-baseline justify-between">
                  <span className="t-label text-silver">{b.label}</span>
                  <span className="t-data text-[13px] text-ink">
                    <CountUp value={Math.round(b.value * 100)} />%
                  </span>
                </div>
                <div className="bar-track mt-2.5">
                  <div className="bar-fill" style={{ width: `${Math.max(1, b.value * 100)}%` }} />
                </div>
                <div className="t-data mt-1.5 text-[12px] text-mute">{b.detail}</div>
              </div>
            ))}
          </div>
          {/* subsystems */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4">
            {state.anatomy.map((a) => {
              const until = a.unlockAt !== null && age !== null ? realSeconds(a.unlockAt - Math.max(0, age), state.simSpeed) : null;
              return (
                <div key={a.key} className="row-hover bg-black p-4">
                  <div className="flex items-center gap-2">
                    <span className={`dot ${a.active ? "text-glow shadow-[0_0_8px_rgba(207,230,255,0.9)]" : a.partial ? "text-silver" : "text-faint"}`} />
                    <span className={`t-label ${a.active ? "text-ink" : ""}`}>{a.label}</span>
                  </div>
                  <div className="t-data mt-3 text-[12px] text-dim">{a.active ? "online" : until !== null && until > 0 ? `in ${fmtCountdown(until)}` : a.partial ? "partial" : "locked"}</div>
                </div>
              );
            })}
          </div>
        </Reveal>

        <Reveal delay={80} className="panel flex min-h-[420px] flex-col overflow-hidden lg:col-span-5">
          <div className="flex gap-1 border-b border-line px-3 py-2.5" role="tablist">
            {(
              [
                ["memory", `Memory ${memories.length}`],
                ["contacts", `Contacts ${people.length}`],
                ["words", `Words ${slang.length}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="scroll-thin max-h-[460px] flex-1 overflow-y-auto">
            {tab === "memory" &&
              (memories.length === 0 ? (
                <p className="p-5 text-[14px] text-dim">Long-term memory mounts at T+14:00 and backfills its first minutes.</p>
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {memories.map((m) => (
                    <li key={m.id} className="row-hover px-5 py-4">
                      <div className="t-label mb-1.5 flex gap-3">
                        <span className="text-glow">{m.kind}</span>
                        <span className="tnum">{fmtAgeShort(m.ageS)}</span>
                        {m.userHandle && <span className="normal-case">@{m.userHandle}</span>}
                      </div>
                      <div className="text-[15px] leading-snug text-ink">{m.content}</div>
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "contacts" &&
              (people.length === 0 ? (
                <p className="p-5 text-[14px] text-dim">From T+14:00 it remembers who talked to it, and when.</p>
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {people.map((p) => (
                    <li key={`${p.platform}:${p.handle}`} className="row-hover px-5 py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-mono text-[14px] text-ink">@{p.handle}</span>
                        <span className="t-data shrink-0 text-[12px] text-mute">
                          {p.interactions}× · met at {fmtAgeShort(p.firstSeenAgeS)}
                        </span>
                      </div>
                      {p.relationshipSummary && <div className="mt-1 text-[14px] text-dim">{p.relationshipSummary}</div>}
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "words" &&
              (slang.length === 0 ? (
                <p className="p-5 text-[14px] text-dim">Dialect parsing unlocks at T+16:00.</p>
              ) : (
                <div className="flex flex-wrap gap-2 p-5">
                  {slang.map((w) => (
                    <span key={w.term} title={w.definition} className="rounded-full border border-line2 px-3 py-1.5 font-mono text-[12px] text-ink">
                      {w.term}
                    </span>
                  ))}
                </div>
              ))}
          </div>
        </Reveal>
      </div>
    </Module>
  );
}

// ── 05 Token ───────────────────────────────────────────────────────────────
export function Token() {
  const state = useStore((s) => s.state);
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const token = state.token;
  const ca = token.mint;
  const v = state.vitals;
  return (
    <Module id="token" index="05" title="Token" meta={token.symbol ? `$${token.symbol}` : undefined}>
      <Reveal className="panel p-5 sm:p-8">
        <div className="t-label mb-3">Contract address</div>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="t-data break-all text-[18px] leading-snug text-ink sm:text-[24px]">{ca ?? "revealed with root access"}</div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!ca}
              aria-live="polite"
              onClick={() => ca && navigator.clipboard?.writeText(ca).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
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
        <div className="hair my-8" />
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {(
            [
              ["Market cap", fmtUsd(v.mcapUsd)],
              ["Liquidity", fmtUsd(v.liquidityUsd)],
              ["Holders", v.holders?.toLocaleString() ?? "—"],
              ["Mentions", v.mentions.toLocaleString()],
            ] as const
          ).map(([k, val]) => (
            <div key={k}>
              <div className="t-label">{k}</div>
              <div className="t-data mt-2 text-[22px] text-ink">{val}</div>
            </div>
          ))}
        </div>
      </Reveal>
    </Module>
  );
}

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="btn">
    {children} <Icon name="ext" className="h-3 w-3" />
  </a>
);
