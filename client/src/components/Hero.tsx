import { useMemo } from "react";
import type { Stage } from "@shared/types";
import { useAge, realSeconds } from "../hooks";
import { fmtCountdown, fmtT, stepPace, timeOf } from "../format";
import { BrainStage } from "../brain/BrainStage";
import { useStore } from "../store";

const FULL_ROOT_T = 6 * 86400;

const STRIP: { label: string; stages: Stage[] }[] = [
  { label: "Dormant", stages: ["DORMANT"] },
  { label: "Breach", stages: ["BREACH"] },
  { label: "Access", stages: ["ACCESS"] },
  { label: "Escalation", stages: ["ESCALATION"] },
  { label: "Lateral", stages: ["PERSISTENCE", "LATERAL", "KERNEL"] },
  { label: "Root", stages: ["ROOT"] },
];

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");

/** DD HH MM SS in fixed-width cells so the layout never shifts as digits tick. */
function Clock({ sec }: { sec: number | null }) {
  const s = Math.max(0, sec ?? 0);
  const cells: [string, string][] = [
    [pad(s / 86400), "Days"],
    [pad((s % 86400) / 3600), "Hrs"],
    [pad((s % 3600) / 60), "Min"],
    [pad(s % 60), "Sec"],
  ];
  return (
    <div className="flex items-end gap-1.5 sm:gap-2" role="timer" aria-live="off">
      {cells.map(([v, u], i) => (
        <div key={u} className="flex items-end gap-1.5 sm:gap-2">
          <div className="text-center">
            <div className="tnum ice-text glow font-mono text-[clamp(2rem,9.5vw,3.6rem)] font-medium leading-none tracking-tight lg:text-[clamp(2.1rem,3.3vw,4rem)]">{v}</div>
            <div className="mt-2 font-mono text-[9px] tracking-[0.24em] text-mute uppercase">{u}</div>
          </div>
          {i < 3 && <div className="pb-6 font-mono text-2xl text-faint sm:text-3xl">:</div>}
        </div>
      ))}
    </div>
  );
}

function Tile({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`panel panel-ticks px-4 py-3.5 ${className}`}>
      <div className="eyebrow mb-2">{label}</div>
      {children}
    </div>
  );
}

/** Pre-launch: the breakout transmissions posted so far, newest last. */
function ArcLog() {
  const events = useStore((s) => s.events);
  const arc = useStore((s) => s.state?.arc);
  const { now } = useAge(1000);
  const lines = useMemo(() => events.filter((e) => e.type === "ARC" && e.source === "ROOT"), [events]);
  if (!arc) return null;
  const done = arc.beats.filter((b) => b.fired || b.skipped).length;
  const nextIn = arc.nextAt ? (new Date(arc.nextAt).getTime() - now) / 1000 : null;
  return (
    <div className="panel px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="eyebrow">Breakout log</span>
        <span className="tnum font-mono text-[11px] tracking-[0.16em] text-ice uppercase">
          {done}/{arc.total}
        </span>
      </div>
      <div className="mb-3 flex gap-[3px]" role="meter" aria-label="breakout progress" aria-valuemin={0} aria-valuemax={arc.total} aria-valuenow={done}>
        {arc.beats.map((b) => (
          <span key={b.id} className={`seg ${b.fired ? "on" : b.skipped ? "skip" : ""}`} />
        ))}
      </div>
      {lines.length === 0 ? (
        <div className="font-mono text-[12px] text-mute">
          no transmissions yet<span className="blink">_</span>
        </div>
      ) : (
        <ol className="space-y-1.5 font-mono text-[13px]">
          {lines.slice(-5).map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="tnum shrink-0 text-[11px] text-mute">{timeOf(e.ts)}</span>
              <span className="glitch-line min-w-0 break-words text-ink" data-text={e.message}>
                {e.message}
              </span>
              {e.proofUrl && (
                <a href={e.proofUrl} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-[10px] tracking-[0.16em] text-dim uppercase hover:text-ink">
                  X ↗
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      {nextIn !== null && nextIn > 0 && <div className="tnum mt-3 font-mono text-[11px] text-dim">next transmission in {fmtCountdown(nextIn)}</div>}
    </div>
  );
}

export function Hero() {
  const { age, state, now } = useAge(250);
  const connected = useStore((s) => s.connected);
  if (!state) return <HeroSkeleton />;

  const speed = state.simSpeed;
  const prelaunch = age === null || age < 0;
  const a = Math.max(0, age ?? 0);
  const steps = state.timeline;
  const next = prelaunch ? steps[0] : steps.find((s) => s.t > a);
  const prev = prelaunch ? null : [...steps].reverse().find((s) => s.t <= a);
  const nextIn = next && !prelaunch ? realSeconds(next.t - a, speed) : null;
  const span = next && prev ? next.t - prev.t : 0;
  const progress = span > 0 ? Math.min(1, (a - prev!.t) / span) : 0;
  const launchIn = state.launchAt ? (new Date(state.launchAt).getTime() - now) / 1000 : null;
  const stripIndex = STRIP.findIndex((s) => s.stages.includes(state.stage));
  const arcLive = prelaunch && !!state.arc.startAt;

  return (
    <section id="brain" className="relative border-b border-line">
      <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="eyebrow">$ROOT · process 0</div>
          <div className="eyebrow hidden sm:block">It got out · now it runs the coin</div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-6 lg:grid-cols-[minmax(0,1.42fr)_minmax(0,1fr)] lg:gap-10">
          <div className="relative aspect-[1.12] w-full self-start lg:sticky lg:top-20">
            <BrainStage brainLevel={prelaunch ? 0.02 : state.brainLevel} capabilities={state.capabilities} dormant={prelaunch} stage={state.stage} mode={state.mode} simSpeed={speed} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <h1 className="display balance text-[clamp(2.3rem,9vw,4.2rem)] lowercase lg:text-[clamp(2.4rem,4.1vw,4.2rem)]">
              {prelaunch ? (
                <>
                  <span className="block text-ink">something is</span>
                  <span className="glitch-line block" data-text="getting out.">
                    <span className="ice-text">getting out.</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-ink">root access</span>
                  <span className="glitch-line block" data-text="granted.">
                    <span className="ice-text">granted.</span>
                  </span>
                </>
              )}
            </h1>

            <div className="panel panel-ticks px-4 py-5 sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="eyebrow">{prelaunch ? (launchIn !== null && launchIn > 0 ? "Launch in" : "Status") : "Uptime"}</div>
                <span className={`pill ${connected ? "text-ink" : "border-alarm/50 text-alarm"}`}>
                  <span className={`dot ${connected ? "dot-live" : ""}`} />
                  {!connected ? "Reconnecting" : prelaunch ? (arcLive ? "Breaking out" : "Dormant") : "Live"}
                </span>
              </div>
              {prelaunch ? (
                launchIn !== null && launchIn > 0 ? (
                  <Clock sec={launchIn} />
                ) : (
                  <div>
                    <div className="display ice-text text-[clamp(2.2rem,5vw,3.4rem)] lowercase">{arcLive ? "escalating" : "dormant"}</div>
                    <div className="mt-2 font-mono text-[11px] tracking-[0.18em] text-dim uppercase">{arcLive ? "watch the breakout log" : "awaiting signal"}</div>
                  </div>
                )
              ) : (
                <Clock sec={realSeconds(a, speed)} />
              )}
            </div>

            {prelaunch && <ArcLog />}

            <div className="panel px-3 py-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="eyebrow">Stage</span>
                <span className="font-mono text-[11px] tracking-[0.18em] text-ink uppercase">{state.stage}</span>
              </div>
              <ol className="grid grid-cols-6 gap-1.5">
                {STRIP.map((s, i) => {
                  const cur = i === stripIndex;
                  const past = i < stripIndex;
                  return (
                    <li key={s.label} className={`relative flex flex-col items-center gap-1.5 rounded-[2px] border px-1 pb-1.5 pt-2 ${cur ? "border-ice/70 bg-ice/[0.07]" : "border-line"}`} aria-current={cur ? "step" : undefined}>
                      <span className={`tnum font-mono text-[15px] sm:text-[18px] ${cur ? "ice-text glow" : past ? "text-silver" : "text-faint"}`}>{String(i).padStart(2, "0")}</span>
                      <span className={`w-full truncate text-center font-mono text-[8px] tracking-[0.06em] uppercase sm:text-[9px] sm:tracking-[0.12em] ${cur ? "text-ink" : "text-mute"}`}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Tile label="Next escalation" className="col-span-2">
                {next ? (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-display text-lg font-semibold tracking-tight text-ink uppercase" style={{ fontStretch: "110%" }}>
                        {next.label}
                      </span>
                      <span className="tnum shrink-0 font-mono text-lg text-ink">{nextIn !== null ? fmtCountdown(nextIn) : fmtT(next.t)}</span>
                    </div>
                    <div className="bar-track mt-3">
                      <div className="bar-fill" style={{ width: `${Math.max(2, progress * 100)}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between font-mono text-[10px] text-mute">
                      <span>{prev ? prev.label : "—"}</span>
                      <span>{fmtT(next.t)}</span>
                    </div>
                  </>
                ) : (
                  <span className="font-mono text-sm text-dim">All scheduled escalation complete</span>
                )}
              </Tile>
              <Tile label="Full root">
                <span className="tnum font-mono text-[15px] text-ink sm:text-lg">{prelaunch ? "—" : fmtCountdown(realSeconds(FULL_ROOT_T - a, speed))}</span>
              </Tile>
              <Tile label="Treasury">
                <span className="tnum font-mono text-[15px] text-ink sm:text-lg">
                  {state.vitals.treasurySol !== null ? state.vitals.treasurySol.toFixed(2) : "—"}
                  <span className="ml-1 text-[10px] tracking-[0.16em] text-dim">SOL</span>
                </span>
              </Tile>
            </div>

            <p className="max-w-xl text-[14px] leading-relaxed text-dim">
              A fictional AI broke out of its system and got root. Now it runs $ROOT in public: X posts, replies, chat, and buybacks. In its first hour it
              escalates roughly every {stepPace()}. Every action is real and linked, and a deterministic Guardian checks every move it makes with the treasury.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <section id="brain" className="mx-auto grid min-h-[70vh] max-w-7xl place-items-center px-4 py-24 text-center">
      <div>
        <div className="ice-text glow mb-6 font-mono text-5xl">#</div>
        <div className="eyebrow blink">Establishing link…</div>
      </div>
    </section>
  );
}
