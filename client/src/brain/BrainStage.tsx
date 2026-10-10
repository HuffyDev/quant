import { Component, lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { Capability, Stage } from "@shared/types";
import { useStore } from "../store";
import { REGIONS, regionActivity } from "./regions";
import { initialTier, type LabelAnchor } from "./QuantumBrain";

const QuantumBrain = lazy(() => import("./QuantumBrain"));

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Static fallback: no WebGL, reduced motion, or a device that can't hold the frame rate. */
export function StaticBrain({ dormant }: { dormant: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <img src="/root.png" alt="ROOT" className={`static-brain h-[62%] w-auto object-contain ${dormant ? "opacity-40" : ""}`} />
    </div>
  );
}

function Signal({ live }: { live: boolean }) {
  const trace = "M0 20 H30 l4 -12 4 22 4 -18 4 8 h10 l3 -6 3 6 H120";
  return (
    <svg className="ecg h-6 w-40 sm:w-56" viewBox="0 0 240 40" aria-hidden>
      <path d="M0 20 H240" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" fill="none" />
      {live && (
        <g>
          <path className="trace" d={trace} stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.25" fill="none" />
          <path className="trace" d={trace} transform="translate(120 0)" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.25" fill="none" style={{ animationDelay: "1.3s" }} />
        </g>
      )}
    </svg>
  );
}

/** The hero chamber: quantum brain + region labels + HUD. */
export function BrainStage({
  brainLevel,
  capabilities,
  dormant,
  stage,
  mode,
  simSpeed,
}: {
  brainLevel: number;
  capabilities: Record<Capability, boolean>;
  dormant: boolean;
  stage: Stage;
  mode: "sim" | "live";
  simSpeed: number;
}) {
  const start = useMemo(initialTier, []);
  const [gaveUp, setGaveUp] = useState(false);
  const giveUp = useCallback(() => setGaveUp(true), []);
  const connected = useStore((s) => s.connected);
  const active = regionActivity(capabilities);
  const activeKey = active.join("");
  const stableActive = useMemo(() => active, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const online = Object.values(capabilities).filter(Boolean).length;
  const total = Object.keys(capabilities).length;
  const use3D = start !== null && !gaveUp;
  const pct = Math.round(brainLevel * 100);

  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const labels = useMemo<LabelAnchor>(
    () => ({
      update(i, x, y, front) {
        const el = labelEls.current[i];
        if (!el) return;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.setProperty("--depth", String(Math.max(0.35, Math.min(1, 0.7 + front * 0.6))));
      },
    }),
    [],
  );

  return (
    <div className="chamber h-full w-full" style={{ ["--scan-h" as string]: "110%" }}>
      <div className="chamber-grid" />
      <div className="absolute inset-0 z-[1]">
        {use3D ? (
          <GLBoundary fallback={<StaticBrain dormant={dormant} />}>
            <Suspense fallback={null}>
              <QuantumBrain level={dormant ? 0.04 : brainLevel} active={stableActive} startTier={start} onGiveUp={giveUp} labels={labels} />
            </Suspense>
          </GLBoundary>
        ) : (
          <StaticBrain dormant={dormant} />
        )}
        {/* region labels (projected from the 3D anchors; static positions when there is no canvas) */}
        <div className="pointer-events-none absolute inset-0 hidden [container-type:size] sm:block" aria-hidden={use3D}>
          {REGIONS.map((r, i) => (
            <div
              key={r.key}
              ref={(el) => {
                labelEls.current[i] = el;
              }}
              className={`region-label ${active[i] ? "on" : ""}`}
              style={use3D ? undefined : { transform: `translate(${[18, 72, 50, 80, 26, 76][i]}cqw, ${[64, 30, 52, 72, 26, 58][i]}cqh)` }}
            >
              <span className="region-tick" />
              {r.key}
            </div>
          ))}
        </div>
      </div>

      <div className="chamber-vignette" />
      <div className="chamber-glass" />
      <div className="scanline" />
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-6 top-4 z-[6] flex items-start justify-between gap-3 sm:inset-x-10 sm:top-5">
        <div>
          <div className="hud-label text-silver">uid=0(root)</div>
          <div className="hud-label mt-1 hidden text-mute sm:block">{dormant ? "process: dormant" : "process: detached"}</div>
        </div>
        <div className="text-right">
          <div className="hud-label">Neural density</div>
          <div className="tnum mt-0.5 font-mono text-xl text-ink sm:text-2xl">
            {String(dormant ? 0 : pct).padStart(2, "0")}
            <span className="text-xs text-dim">%</span>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-6 bottom-4 z-[6] flex items-end justify-between gap-3 sm:inset-x-10 sm:bottom-5">
        <div className="hud-label">
          <div className={mode === "sim" ? "text-amber" : "text-ink"}>{mode === "sim" ? `Sim ×${simSpeed}` : "Live feed"}</div>
          <div className="tnum mt-1 hidden text-mute sm:block">
            {String(online).padStart(2, "0")}/{total} capabilities
          </div>
        </div>
        <div className="hidden text-ice sm:block">
          <Signal live={connected && !dormant} />
        </div>
        <div className="hud-label text-right">
          <div className="text-ink">{stage}</div>
          <div className="mt-1 hidden text-mute sm:block">{connected ? "link stable" : "link lost"}</div>
        </div>
      </div>
    </div>
  );
}
