import { useEffect, useState } from "react";
import { liveAge, useStore } from "./store";

/** Re-render every `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Live (sim-)age in seconds, ticking. Negative before launch, null if no launch set. */
export function useAge(ms = 250) {
  const now = useNow(ms);
  const state = useStore((s) => s.state);
  const receivedAt = useStore((s) => s.receivedAt);
  return { age: liveAge(state, receivedAt, now), state, now };
}

/** Convert a baby-time span to real seconds for countdowns. */
export function realSeconds(babySeconds: number, simSpeed: number) {
  return babySeconds / simSpeed;
}
