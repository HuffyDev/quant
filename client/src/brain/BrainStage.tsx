import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Capability } from "@shared/types";
import { REGIONS, regionActivity } from "./regions";
import { initialTier } from "./quality";
import type { LabelAnchor } from "./QuantumBrain";
import { BrainImage, imageScale } from "./BrainImage";

const QuantumBrain = lazy(() => import("./QuantumBrain"));

export class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onFail?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail?.();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Full-bleed hero stage: the brain, a cursor-following glow, scanlines (this stage only) and faint region
 * callouts that light as capabilities unlock.
 */
export function BrainStage({
  brainLevel,
  capabilities,
  dormant,
  powerAt,
  distance,
}: {
  brainLevel: number;
  capabilities: Record<Capability, boolean>;
  dormant: boolean;
  powerAt: number | null;
  distance: number;
}) {
  const start = useMemo(initialTier, []);
  const [gaveUp, setGaveUp] = useState(false);
  const giveUp = useCallback(() => setGaveUp(true), []);
  const [shown, setShown] = useState(false);
  const show = useCallback(() => setShown(true), []);
  const active = regionActivity(capabilities);
  const activeKey = active.join("");
  const stableActive = useMemo(() => active, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const use3D = start !== null && !gaveUp;
  const stage = useRef<HTMLDivElement>(null);

  // cursor glow (CSS vars; no React re-render)
  useEffect(() => {
    const el = stage.current;
    if (!el || matchMedia("(pointer: coarse)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const labels = useMemo<LabelAnchor>(
    () => ({
      update(i, x, y, front) {
        const el = labelEls.current[i];
        if (!el) return;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.visibility = "visible";
        el.style.setProperty("--depth", String(Math.max(0.4, Math.min(1, 0.75 + front * 0.5))));
      },
    }),
    [],
  );

  return (
    <div ref={stage} className="absolute inset-0 overflow-hidden bg-black">
      {/* the image is always underneath: static fallback, and what shows while the 3D brain loads */}
      {(!use3D || powerAt !== null) && <BrainImage scale={imageScale(distance)} dormant={dormant} hidden={use3D && shown} />}
      {use3D && powerAt !== null && (
        <GLBoundary fallback={null} onFail={giveUp}>
          <div className={`brain-gl ${shown ? "is-on" : ""}`}>
            <Suspense fallback={null}>
              <QuantumBrain level={dormant ? 0.15 : Math.max(0.35, brainLevel)} active={stableActive} startTier={start} onGiveUp={giveUp} onShown={show} labels={labels} distance={distance} spin={0.05} interactive bootAt={powerAt} />
            </Suspense>
          </div>
        </GLBoundary>
      )}
      {use3D && shown && (
        <div className="pointer-events-none absolute inset-0 z-[2] hidden lg:block" aria-hidden>
          {REGIONS.map((r, i) => (
            <div
              key={r.key}
              ref={(el) => {
                labelEls.current[i] = el;
              }}
              className={`region-label ${active[i] ? "on" : ""}`}
            >
              <span className="region-tick" />
              {r.key}
            </div>
          ))}
        </div>
      )}
      <div className="hero-glow" />
      <div className="scanlines" />
      <div className="scan-sweep" />
    </div>
  );
}
