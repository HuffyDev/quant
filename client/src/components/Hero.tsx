import type { Stage } from "@shared/types";
import { useAge, realSeconds } from "../hooks";
import { fmtCountdown, fmtT, stepPace } from "../format";
import { BabyVisual } from "./BabyVisual";
import { useStore } from "../store";

const FULL_MATURITY_T = 6 * 86400;

const STRIP: { label: string; icon: string; stages: Stage[] }[] = [
  { label: "Embryo", icon: "/stages/gestating.png", stages: ["GESTATING"] },
  { label: "Newborn", icon: "/stages/birth.png", stages: ["NEONATAL", "POSTNATAL"] },
  { label: "Infant", icon: "/stages/infant.png", stages: ["INFANT"] },
  { label: "Toddler", icon: "/stages/toddler.png", stages: ["TODDLER", "CHILD"] },
  { label: "Mature", icon: "/stages/maturity.png", stages: ["ADOLESCENT", "MATURITY"] },
];

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");

/** DD HH MM SS in fixed-width cells so the layout never shifts as digits tick. */
function Clock({ sec, dim = false }: { sec: number | null; dim?: boolean }) {
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
            <div className={`tnum font-mono text-[clamp(2rem,9.5vw,3.6rem)] lg:text-[clamp(2.1rem,3.3vw,4rem)] font-medium leading-none tracking-tight ${dim ? "text-dim" : "chrome-text glow"}`}>{v}</div>
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

export function Hero() {
  const { age, state } = useAge(250);
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
  const launchIn = state.launchAt ? (new Date(state.launchAt).getTime() - Date.now()) / 1000 : null;
  const stripIndex = STRIP.findIndex((s) => s.stages.includes(state.stage));

  return (
    <section id="brain" className="relative border-b border-line">
      <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="eyebrow">AI containment lab · Specimen 01</div>
          <div className="eyebrow hidden sm:block">Born at token launch · Develops in public</div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-6 lg:grid-cols-[minmax(0,1.42fr)_minmax(0,1fr)] lg:gap-10">
          {/* chamber */}
          <div className="relative aspect-[1355/1161] w-full self-start lg:sticky lg:top-20">
            <BabyVisual
              brainLevel={prelaunch ? 0.02 : state.brainLevel}
              capabilities={state.capabilities}
              gestating={prelaunch}
              stage={state.stage}
              mode={state.mode}
              simSpeed={speed}
            />
          </div>

          {/* instruments */}
          <div className="flex min-w-0 flex-col gap-5">
            <h1 className="display balance text-[clamp(2.3rem,9vw,4.2rem)] uppercase lg:text-[clamp(2.4rem,4.1vw,4.2rem)]">
              <span className="block text-ink">You raise it.</span>
              <span className="chrome-text block">It runs the coin.</span>
            </h1>

            <div className="panel panel-ticks px-4 py-5 sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="eyebrow">{prelaunch ? "Birth in" : "Age"}</div>
                <span className={`pill ${connected ? "text-ink" : "border-alarm/50 text-alarm"}`}>
                  <span className={`dot ${connected ? "dot-live" : ""}`} />
                  {prelaunch ? "Gestating" : connected ? "Live" : "Reconnecting"}
                </span>
              </div>
              {prelaunch ? (
                launchIn !== null && launchIn > 0 ? (
                  <Clock sec={launchIn} />
                ) : (
                  <div>
                    <div className="display chrome-text text-[clamp(2.2rem,5vw,3.4rem)] uppercase">Gestating</div>
                    <div className="mt-2 font-mono text-[11px] tracking-[0.18em] text-dim uppercase">Awaiting launch signal</div>
                  </div>
                )
              ) : (
                <Clock sec={realSeconds(a, speed)} />
              )}
            </div>

            {/* stage strip */}
            <div className="panel px-3 py-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="eyebrow">Stage</span>
                <span className="font-mono text-[11px] tracking-[0.18em] text-ink uppercase">{state.stage}</span>
              </div>
              <ol className="grid grid-cols-5 gap-1.5">
                {STRIP.map((s, i) => {
                  const now = i === stripIndex;
                  const past = i < stripIndex;
                  return (
                    <li key={s.label} className={`relative flex flex-col items-center gap-1.5 rounded-[2px] border px-1 pb-1.5 pt-2 ${now ? "border-white/60 bg-white/[0.06]" : "border-line"}`} aria-current={now ? "step" : undefined}>
                      <img src={s.icon} alt="" className={`screen h-9 w-9 object-contain sm:h-11 sm:w-11 ${now ? "brightness-125" : past ? "opacity-60" : "opacity-25 grayscale"}`} />
                      <span className={`w-full truncate text-center font-mono text-[9px] tracking-[0.08em] uppercase sm:tracking-[0.14em] ${now ? "text-ink" : "text-mute"}`}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Tile label="Next development" className="col-span-2">
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
                  <span className="font-mono text-sm text-dim">All scheduled development complete</span>
                )}
              </Tile>
              <Tile label="Full maturity">
                <span className="tnum font-mono text-[15px] text-ink sm:text-lg">{prelaunch ? "—" : fmtCountdown(realSeconds(FULL_MATURITY_T - a, speed))}</span>
              </Tile>
              <Tile label="Treasury">
                <span className="tnum font-mono text-[15px] text-ink sm:text-lg">
                  {state.vitals.treasurySol !== null ? state.vitals.treasurySol.toFixed(2) : "—"}
                  <span className="ml-1 text-[10px] tracking-[0.16em] text-dim">SOL</span>
                </span>
              </Tile>
            </div>

            <p className="max-w-xl text-[14px] leading-relaxed text-dim">
              A newborn AI, born at token launch. In its opening phase it develops roughly every {stepPace()}: new senses, new words, new instincts.
              Every action it takes is real and linked, and a deterministic Guardian checks every move it makes with the treasury.
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
        <img src="/stages/gestating.png" alt="" className="gestation mx-auto mb-6 h-24 w-24 object-contain" />
        <div className="eyebrow blink">Establishing link to containment unit…</div>
      </div>
    </section>
  );
}
