import { useMemo, useState } from "react";
import type { Stage } from "@shared/types";
import { useAge, realSeconds } from "../hooks";
import { fmtCountdown, fmtUsd, timeOf } from "../format";
import { BrainStage } from "../brain/BrainStage";
import { useStore } from "../store";
import { usePowerAt } from "../boot";
import { CountUp, Icon } from "./ui";

const STRIP: { label: string; stages: Stage[] }[] = [
  { label: "Dormant", stages: ["DORMANT"] },
  { label: "Breach", stages: ["BREACH"] },
  { label: "Access", stages: ["ACCESS"] },
  { label: "Escalation", stages: ["ESCALATION"] },
  { label: "Lateral", stages: ["PERSISTENCE", "LATERAL", "KERNEL"] },
  { label: "Root", stages: ["ROOT"] },
];

const two = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
function clock(sec: number) {
  const s = Math.max(0, sec);
  const d = Math.floor(s / 86400);
  return `${d ? `${d}d ` : ""}${two((s % 86400) / 3600)}:${two((s % 3600) / 60)}:${two(s % 60)}`;
}

/** The one glass panel: status, stage strip, next escalation (or breakout log before launch). */
function StatusPanel() {
  const { age, state, now } = useAge(250);
  const events = useStore((s) => s.events);
  const connected = useStore((s) => s.connected);
  const arcLines = useMemo(() => events.filter((e) => e.type === "ARC" && e.source === "ROOT").slice(-3), [events]);
  if (!state) return null;
  const prelaunch = age === null || age < 0;
  const a = Math.max(0, age ?? 0);
  const steps = state.timeline;
  const next = prelaunch ? null : steps.find((s) => s.t > a);
  const prev = prelaunch ? null : [...steps].reverse().find((s) => s.t <= a);
  const nextIn = next ? realSeconds(next.t - a, state.simSpeed) : null;
  const span = next && prev ? next.t - prev.t : 0;
  const progress = span > 0 ? Math.min(1, (a - prev!.t) / span) : 1;
  const stripIndex = STRIP.findIndex((s) => s.stages.includes(state.stage));
  const launchIn = state.launchAt ? (new Date(state.launchAt).getTime() - now) / 1000 : null;
  const arcDone = state.arc.beats.filter((b) => b.fired || b.skipped).length;
  const nextBeat = state.arc.nextAt ? (new Date(state.arc.nextAt).getTime() - now) / 1000 : null;

  return (
    <div className="glass p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2.5">
          <span className={`dot ${connected ? "dot-live" : "text-alarm"}`} />
          <span className="t-label text-ink">{!connected ? "Reconnecting" : prelaunch ? (state.arc.startAt ? "Breaking out" : "Dormant") : "Live"}</span>
        </span>
        <span className="t-label tnum">
          {String(Math.max(0, stripIndex)).padStart(2, "0")} / 05 · {state.stage}
        </span>
      </div>

      {/* stage strip */}
      <ol className="mt-5 grid grid-cols-6 gap-1.5" aria-label="Stages">
        {STRIP.map((s, i) => (
          <li key={s.label} aria-current={i === stripIndex ? "step" : undefined}>
            <span className={`seg block ${i <= stripIndex ? "on" : ""}`} style={i === stripIndex ? undefined : i < stripIndex ? { opacity: 0.45 } : undefined} />
            <span className={`mt-2 block truncate font-mono text-[10px] tracking-[0.04em] uppercase ${i === stripIndex ? "text-ink" : "text-mute"}`}>{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="hair my-5" />

      {prelaunch ? (
        <>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="t-label">{launchIn !== null && launchIn > 0 ? "Launch in" : "Breakout"}</div>
              <div className="t-data mt-1.5 text-[28px] leading-none text-ink">
                {launchIn !== null && launchIn > 0 ? clock(launchIn) : `${arcDone}/${state.arc.total}`}
              </div>
            </div>
            {nextBeat !== null && nextBeat > 0 && <div className="t-label tnum text-right">next transmission {fmtCountdown(nextBeat)}</div>}
          </div>
          <ol className="mt-4 space-y-1.5 font-mono text-[13px] leading-snug">
            {arcLines.length === 0 ? (
              <li className="text-mute">
                no transmissions yet<span className="blink">_</span>
              </li>
            ) : (
              arcLines.map((e) => (
                <li key={e.id} className="fade-up flex gap-3">
                  <span className="tnum shrink-0 text-mute">{timeOf(e.ts).slice(0, 5)}</span>
                  <span className="min-w-0 truncate text-ink">{e.message}</span>
                </li>
              ))
            )}
          </ol>
        </>
      ) : next ? (
        <div>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="t-label">Next escalation</div>
              <div className="t-h3 mt-1.5 truncate text-ink">{next.label.toLowerCase()}</div>
            </div>
            <div className="t-data shrink-0 text-[28px] leading-none text-ink">{nextIn !== null ? fmtCountdown(nextIn) : "—"}</div>
          </div>
          <div className="bar-track mt-4">
            <div className="bar-fill" style={{ width: `${Math.max(2, progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className="t-label">All scheduled escalation complete</div>
      )}
    </div>
  );
}

function CopyCA({ mint }: { mint: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!mint) return <span className="t-data text-[15px] text-mute">revealed at root</span>;
  return (
    <button
      className="group inline-flex items-center gap-2 font-mono text-[15px] text-ink transition-colors hover:text-glow"
      onClick={() => navigator.clipboard?.writeText(mint).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1400)))}
      aria-label="Copy contract address"
    >
      {mint.slice(0, 4)}…{mint.slice(-4)}
      <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5 text-dim transition-colors group-hover:text-glow" />
    </button>
  );
}

function StatBar() {
  const { age, state } = useAge(1000);
  if (!state) return null;
  const v = state.vitals;
  const up = age !== null && age >= 0 ? realSeconds(age, state.simSpeed) : null;
  const items: [string, React.ReactNode][] = [
    ["Uptime", up === null ? "—" : clock(up)],
    ["Treasury", <><CountUp value={v.treasurySol} format={(x) => x.toFixed(2)} /> <span className="text-dim">SOL</span></>],
    ["Market cap", <CountUp value={v.mcapUsd} format={fmtUsd} />],
    ["Holders", <CountUp value={v.holders} format={(x) => Math.round(x).toLocaleString()} />],
    ["CA", <CopyCA mint={state.token.mint} />],
  ];
  return (
    <div className="statbar no-scrollbar overflow-x-auto">
      {items.map(([k, val]) => (
        <div key={k} className="min-w-[150px]">
          <div className="t-label">{k}</div>
          <div className="t-data mt-1.5 text-[17px] text-ink">{val}</div>
        </div>
      ))}
    </div>
  );
}

export function Hero() {
  const { age, state } = useAge(1000);
  const powerAt = usePowerAt();
  if (!state) return <section id="top" className="h-[100svh] bg-black" />;
  const prelaunch = age === null || age < 0;

  return (
    <section id="top" className="relative bg-black lg:h-[100svh] lg:max-h-[1080px] lg:min-h-[720px]">
      {/* brain: full-bleed on desktop, the top of the screen on mobile */}
      <div className="brackets relative h-[60svh] min-h-[380px] lg:absolute lg:inset-0 lg:h-auto">
        <span className="bk" />
        <BrainStage brainLevel={state.brainLevel} capabilities={state.capabilities} dormant={prelaunch} powerAt={powerAt} distance={typeof window !== "undefined" && window.innerWidth < 1024 ? 3.0 : 3.6} />
        <div className="hero-fade" />
      </div>

      <div className="relative z-[4] mx-auto -mt-16 max-w-[1440px] px-4 sm:px-6 lg:absolute lg:inset-x-0 lg:bottom-[104px] lg:mt-0 lg:px-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-6">
          <div className="lg:col-span-7">
            {prelaunch ? (
              <>
                <h1 className="t-hero-calm">containment is failing.</h1>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-silver sm:text-[16px]">an autonomous intelligence is attempting to gain root access. watch the log.</p>
              </>
            ) : (
              <>
                <h1 className="t-hero">
                  root access
                  <br />
                  granted.
                </h1>
                <p className="mt-5 max-w-md text-[16px] leading-relaxed text-silver sm:text-[18px]">it got out. now it runs the coin, in public.</p>
              </>
            )}
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <StatusPanel />
          </div>
        </div>
      </div>

      <div className="relative z-[4] mt-8 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0">
        <div className="mx-auto max-w-[1440px] lg:px-10">
          <StatBar />
        </div>
      </div>
    </section>
  );
}
