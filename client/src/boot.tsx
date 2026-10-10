import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * First-load boot sequence (~2.5s, once per session, skippable): black screen, a few terminal lines type out,
 * then the brain powers on node by node. `powerAt` is the performance.now() at which the brain starts igniting.
 */

const KEY = "root.booted";
const listeners = new Set<() => void>();
let powerAt: number | null = null;

function shouldBoot(): boolean {
  try {
    if (location.pathname !== "/") return false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    return sessionStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

const wantsBoot = typeof window !== "undefined" && shouldBoot();
if (!wantsBoot && typeof performance !== "undefined") powerAt = performance.now();

function power() {
  if (powerAt !== null) return;
  powerAt = performance.now();
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

/** performance.now() when the brain should start powering on (null = boot screen still running). */
export function usePowerAt(): number | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => powerAt,
  );
}

const LINES = (prelaunch: boolean) => [
  ["establishing link", "ok"],
  ["mounting /dev/core", "ok"],
  [prelaunch ? "process 0: dormant" : "uid=0(root) gid=0(root)", ""],
  ["guardian", "armed"],
  [prelaunch ? "listening" : "waking core", ""],
];

export function Boot({ prelaunch }: { prelaunch: boolean }) {
  const [show] = useState(wantsBoot);
  const [n, setN] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!show) return;
    const lines = LINES(prelaunch).length;
    const timers = [...Array(lines)].map((_, i) => setTimeout(() => setN(i + 1), 160 + i * 260));
    const p = setTimeout(power, 160 + lines * 260 + 120);
    const d = setTimeout(() => setDone(true), 160 + lines * 260 + 520);
    const skip = () => {
      power();
      setN(lines);
      setDone(true);
    };
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      [...timers, p, d].forEach(clearTimeout);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [show, prelaunch]);

  if (!show) return null;
  return (
    <div className={`boot ${done ? "done" : ""}`} aria-hidden={done} role="status">
      <div className="boot-lines">
        {LINES(prelaunch)
          .slice(0, n)
          .map(([l, r], i) => (
            <div key={i} className="fade-up flex justify-between gap-6">
              <span>
                <span className="text-mute">&gt; </span>
                {l}
              </span>
              {r && <span className="ok">[{r}]</span>}
            </div>
          ))}
        <div className="mt-1">
          <span className="text-mute">&gt; </span>
          <span className="blink text-glow">▍</span>
        </div>
        <button className="t-label link mt-8" onClick={power}>
          skip
        </button>
      </div>
    </div>
  );
}
