import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fades/slides children in when scrolled into view (once). Respects reduced motion via CSS. */
export function Reveal({ children, className = "", delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setIn(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setIn(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const El = Tag as "div";
  return (
    <El ref={ref as React.RefObject<HTMLDivElement>} className={`reveal ${inView ? "in" : ""} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </El>
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** A number that ticks to its new value (ease-out). */
export function CountUp({ value, format = (v) => String(Math.round(v)), duration = 900 }: { value: number | null; format?: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value === null) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    const start = performance.now();
    const a = from.current;
    let id = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const v = a + (value - a) * easeOut(k);
      setShown(v);
      if (k < 1) id = requestAnimationFrame(step);
      else from.current = value;
    };
    id = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(id);
      from.current = value;
    };
  }, [value, duration]);
  if (value === null) return <>—</>;
  return <>{format(shown)}</>;
}

/** One numbered module of the machine. */
export function Module({
  id,
  index,
  title,
  meta,
  children,
  className = "",
}: {
  id?: string;
  index: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`min-w-0 ${className}`}>
      <Reveal>
        <header className="module-head">
          <span className="module-num tnum">{index}</span>
          <h2 id={id ? `${id}-title` : undefined} className="t-h2 min-w-0">
            {title}
          </h2>
          {meta ? <div className="t-label hidden text-right sm:block">{meta}</div> : <span />}
        </header>
      </Reveal>
      {children}
    </section>
  );
}

/** Sub-panel title inside a module. */
export function PanelHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <span className="t-label text-silver">{title}</span>
      {meta && <span className="t-label">{meta}</span>}
    </div>
  );
}

/** Intentional empty / locked state. */
export function EmptyState({ title, detail, locked = false, icon }: { title: string; detail?: ReactNode; locked?: boolean; icon?: ReactNode }) {
  return (
    <div className="panel flex items-center gap-4 px-5 py-6">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line2 text-dim">{icon ?? (locked ? <Icon name="lock" /> : <Icon name="pulse" />)}</div>
      <div className="min-w-0">
        <div className="t-label text-silver">{title}</div>
        {detail && <div className="mt-1 text-[14px] text-dim">{detail}</div>}
      </div>
    </div>
  );
}

export function StatusTag({ tone, children }: { tone: "on" | "partial" | "off" | "warn" | "alarm"; children: ReactNode }) {
  const cls = {
    on: "border-glow/50 text-glow",
    partial: "border-line3 text-silver",
    off: "border-line text-mute",
    warn: "border-line3 text-silver",
    alarm: "border-alarm/70 bg-alarm/10 text-alarm",
  }[tone];
  return <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 font-mono text-[10px] leading-none tracking-[0.06em] uppercase ${cls}`}>{children}</span>;
}

type IconName =
  | "eye" | "ear" | "memory" | "brain" | "voice" | "hand" | "shield" | "nerve"
  | "lock" | "pulse" | "copy" | "check" | "ext" | "menu" | "close" | "send" | "down" | "chat" | "bolt";

/** Minimal 1.25px line icons drawn for this UI. */
export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, ReactNode> = {
    eye: (<><path {...p} d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><circle {...p} cx="12" cy="12" r="3" /></>),
    ear: (<><path {...p} d="M7 9a5 5 0 1 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0" /><path {...p} d="M10 10a2 2 0 1 1 4 0c0 1.5-1.5 2-1.5 3" /></>),
    memory: (<><rect {...p} x="5" y="5" width="14" height="14" rx="1.5" /><path {...p} d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /><rect {...p} x="9" y="9" width="6" height="6" /></>),
    brain: (<><path {...p} d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h0a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" /><path {...p} d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3 2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /></>),
    voice: (<><path {...p} d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></>),
    hand: (<><path {...p} d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.4 1.4 0 0 1 2.3-1.6L8 15" /></>),
    shield: (<><path {...p} d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path {...p} d="m9 12 2 2 4-4" /></>),
    nerve: (<><circle {...p} cx="12" cy="12" r="2" /><path {...p} d="M12 10V3M12 14v7M10 12H3M14 12h7M6 6l4.5 4.5M13.5 13.5 18 18M18 6l-4.5 4.5M10.5 13.5 6 18" /></>),
    lock: (<><rect {...p} x="5" y="11" width="14" height="10" rx="1.5" /><path {...p} d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
    pulse: (<><path {...p} d="M3 12h4l2-5 4 10 2-5h6" /></>),
    copy: (<><rect {...p} x="8" y="8" width="12" height="12" rx="1.5" /><path {...p} d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>),
    check: (<><path {...p} d="m5 12 5 5 9-10" /></>),
    ext: (<><path {...p} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>),
    menu: (<><path {...p} d="M4 7h16M4 12h16M4 17h10" /></>),
    close: (<><path {...p} d="M6 6l12 12M18 6 6 18" /></>),
    send: (<><path {...p} d="M4 12 20 4l-6 16-3-7-7-1Z" /></>),
    down: (<><path {...p} d="M12 5v14M6 13l6 6 6-6" /></>),
    chat: (<><path {...p} d="M4 5h16v11H9l-5 4V5Z" /></>),
    bolt: (<><path {...p} d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" /></>),
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}
