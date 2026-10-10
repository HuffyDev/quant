import { Component, lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Capability, Stage } from "@shared/types";
import { useStore } from "../store";
import { REGIONS } from "./regions";

const ParticleBaby = lazy(() => import("./ParticleBaby"));

/** Decide up front whether this device should even try WebGL. */
function canRender3D(): { ok: boolean; maxPoints: number } {
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return { ok: false, maxPoints: 0 };
    const c = document.createElement("canvas");
    if (!(c.getContext("webgl2") || c.getContext("webgl"))) return { ok: false, maxPoints: 0 };
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const mem = nav.deviceMemory ?? 4;
    if (cores <= 2 || mem <= 1) return { ok: false, maxPoints: 0 };
    const mobile = matchMedia("(max-width: 768px)").matches;
    return { ok: true, maxPoints: mobile || cores <= 4 || mem <= 2 ? 9000 : 22000 };
  } catch {
    return { ok: false, maxPoints: 0 };
  }
}

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const MOTES = [
  [12, 70, 0], [22, 84, 3.1], [31, 62, 6.5], [44, 90, 1.7], [58, 76, 9.2], [67, 66, 4.4], [76, 88, 11.3], [84, 72, 7.8], [90, 58, 2.6], [8, 52, 12.4],
];

/** Vertical measurement ruler (decorative scale, no data). */
function Ruler({ side }: { side: "left" | "right" }) {
  const ticks = Array.from({ length: 41 }, (_, i) => i);
  return (
    <svg className={`pointer-events-none absolute top-[8%] bottom-[8%] z-[5] h-[84%] w-7 ${side === "left" ? "left-3" : "right-3"}`} viewBox="0 0 28 400" preserveAspectRatio="none" aria-hidden>
      {ticks.map((i) => {
        const y = (i / 40) * 400;
        const major = i % 10 === 0;
        const mid = i % 5 === 0;
        const len = major ? 12 : mid ? 8 : 4;
        const x1 = side === "left" ? 0 : 28 - len;
        return <line key={i} x1={x1} x2={x1 + len} y1={y} y2={y} stroke="white" strokeOpacity={major ? 0.55 : mid ? 0.3 : 0.16} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

function Ecg({ live }: { live: boolean }) {
  const beat = "M0 20 H40 l6 -2 4 2 h8 l4 -14 5 26 4 -16 3 4 h14 l6 -4 6 4 H120";
  return (
    <svg className="ecg h-6 w-40 sm:w-56" viewBox="0 0 240 40" aria-hidden>
      <path d="M0 20 H240" stroke="white" strokeOpacity="0.12" strokeWidth="1" fill="none" />
      {live && (
        <g>
          <path className="trace" d={beat} stroke="white" strokeOpacity="0.85" strokeWidth="1.25" fill="none" />
          <path className="trace" d={beat} transform="translate(120 0)" stroke="white" strokeOpacity="0.85" strokeWidth="1.25" fill="none" style={{ animationDelay: "1.3s" }} />
        </g>
      )}
    </svg>
  );
}

export function BabyVisual({
  brainLevel,
  capabilities,
  gestating,
  stage,
  mode,
  simSpeed,
}: {
  brainLevel: number;
  capabilities: Record<Capability, boolean>;
  gestating: boolean;
  stage: Stage;
  mode: "sim" | "live";
  simSpeed: number;
}) {
  const caps = useMemo(canRender3D, []);
  const [lowFps, setLowFps] = useState(false);
  const onLowFps = useCallback(() => setLowFps(true), []);
  const lastUnlock = useStore((s) => s.lastUnlock);
  const connected = useStore((s) => s.connected);
  const active = REGIONS.map((r) => (r.caps.some((c) => capabilities[c as Capability]) ? 1 : 0));
  const online = Object.values(capabilities).filter(Boolean).length;
  const total = Object.keys(capabilities).length;
  const use3D = !gestating && caps.ok && !lowFps;
  const pct = Math.round(brainLevel * 100);

  return (
    <div className="chamber h-full w-full" style={{ ["--scan-h" as string]: "110%" }}>
      <div className="chamber-grid" />
      {MOTES.map(([x, y, d], i) => (
        <span key={i} className="mote" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />
      ))}

      {/* specimen box: oversized so the figure fills the chamber while staying crisp */}
      <div className="absolute z-[1]" style={{ left: "-14%", top: "-11%", width: "128%", height: "128%" }}>
        {gestating ? (
          <div className="absolute inset-0 grid place-items-center">
            <img src="/stages/gestating.png" alt="Specimen gestating" className="gestation h-[46%] w-auto object-contain" />
          </div>
        ) : (
          <>
            <img
              src="/baby.png"
              alt="Baby Brain specimen"
              className="specimen-ghost absolute inset-0 h-full w-full object-contain"
              style={{ opacity: use3D ? 0.18 + 0.24 * brainLevel : 0.6 + 0.4 * brainLevel }}
            />
            {use3D && (
              <GLBoundary fallback={null}>
                <Suspense fallback={null}>
                  <ParticleBaby level={brainLevel} active={active} burstKey={lastUnlock?.at ?? 0} maxPoints={caps.maxPoints} onLowFps={onLowFps} />
                </Suspense>
              </GLBoundary>
            )}
            {/* head reticle */}
            <div className="reticle pointer-events-none absolute" style={{ left: "38.5%", top: "33%", transform: "translate(-50%,-50%)" }} aria-hidden>
              <div className="relative h-[clamp(70px,13vw,150px)] w-[clamp(70px,13vw,150px)] rounded-full border border-white/25">
                <div className="absolute inset-[18%] rounded-full border border-dashed border-white/20" />
                <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 -translate-y-1 bg-white/70" />
                <span className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 translate-y-1 bg-white/70" />
                <span className="absolute left-0 top-1/2 h-px w-2 -translate-x-1 -translate-y-1/2 bg-white/70" />
                <span className="absolute right-0 top-1/2 h-px w-2 translate-x-1 -translate-y-1/2 bg-white/70" />
              </div>
            </div>
            {REGIONS.map((r, i) => (
              <div
                key={r.key}
                className="pointer-events-none absolute hidden font-mono text-[9px] tracking-[0.2em] transition-opacity duration-1000 sm:block"
                style={{ left: `${r.u * 100}%`, top: `${r.v * 100}%`, transform: `translate(${r.labelDx}px, ${r.labelDy}px)`, opacity: active[i] ? 0.9 : 0.22, color: active[i] ? "#fff" : "#8f949b" }}
              >
                <span className="mr-1.5 inline-block h-px w-3 align-middle" style={{ background: "currentColor" }} />
                {r.key}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="chamber-vignette" />
      <div className="chamber-glass" />
      <div className="scanline" />
      <Ruler side="left" />
      <Ruler side="right" />
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-10 top-4 z-[6] flex items-start justify-between gap-3 sm:inset-x-14 sm:top-5">
        <div>
          <div className="hud-label text-silver">
            <span className="sm:hidden">Unit 01</span>
            <span className="hidden sm:inline">Containment · Unit 01</span>
          </div>
          <div className="hud-label mt-1 hidden text-mute sm:block">Specimen · Baby Brain</div>
        </div>
        <div className="text-right">
          <div className="hud-label">
            <span className="sm:hidden">Density</span>
            <span className="hidden sm:inline">Neural density</span>
          </div>
          <div className="tnum mt-0.5 font-mono text-xl text-ink sm:text-2xl">
            {String(pct).padStart(2, "0")}
            <span className="text-xs text-dim">%</span>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-10 bottom-4 z-[6] flex items-end justify-between gap-3 sm:inset-x-14 sm:bottom-5">
        <div className="hud-label">
          <div className={mode === "sim" ? "text-amber" : "text-ink"}>{mode === "sim" ? `Sim ×${simSpeed}` : "Live feed"}</div>
          <div className="tnum mt-1 hidden text-mute sm:block">
            {String(online).padStart(2, "0")}/{total} systems online
          </div>
        </div>
        <div className="hidden sm:block">
          <Ecg live={connected} />
        </div>
        <div className="hud-label text-right">
          <div className="text-ink">{stage}</div>
          <div className="mt-1 hidden text-mute sm:block">{connected ? "link stable" : "link lost"}</div>
        </div>
      </div>
    </div>
  );
}
