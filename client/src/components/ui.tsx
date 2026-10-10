import type { ReactNode } from "react";

/** Numbered lab module: the shared frame for every dashboard section. */
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
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="tnum font-mono text-[10px] text-mute">{index}</span>
        <h2 id={id ? `${id}-title` : undefined} className="section-title min-w-0">
          {title}
        </h2>
        <div className="hairline min-w-6 flex-1" aria-hidden />
        {meta && <div className="w-full min-w-0 font-mono text-[10px] tracking-[0.16em] text-dim uppercase sm:w-auto sm:max-w-[50%] sm:truncate sm:text-right">{meta}</div>}
      </header>
      {children}
    </section>
  );
}

/** Intentional empty / locked state. */
export function EmptyState({ title, detail, locked = false, icon }: { title: string; detail?: ReactNode; locked?: boolean; icon?: ReactNode }) {
  return (
    <div className={`panel flex items-center gap-4 px-5 py-6 ${locked ? "stripes" : ""}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line2 text-dim">{icon ?? (locked ? <Icon name="lock" /> : <Icon name="pulse" />)}</div>
      <div className="min-w-0">
        <div className="font-mono text-[11px] tracking-[0.18em] text-silver uppercase">{title}</div>
        {detail && <div className="mt-1 text-[13px] text-dim">{detail}</div>}
      </div>
    </div>
  );
}

/** Fixed-width digit readout (stable while digits change). */
export function Readout({ value, unit, size = "md" }: { value: string; unit?: string; size?: "md" | "lg" | "xl" }) {
  const cls = size === "xl" ? "text-[clamp(2.6rem,7vw,4.6rem)]" : size === "lg" ? "text-[clamp(1.6rem,3.4vw,2.1rem)]" : "text-lg";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`tnum font-mono font-medium leading-none text-ink ${cls}`}>{value}</span>
      {unit && <span className="font-mono text-[10px] tracking-[0.18em] text-dim uppercase">{unit}</span>}
    </span>
  );
}

export function StatusTag({ tone, children }: { tone: "on" | "partial" | "off" | "warn" | "alarm"; children: ReactNode }) {
  const cls = {
    on: "border-white/70 bg-white text-black",
    partial: "border-white/40 text-ink",
    off: "border-line2 text-mute",
    warn: "border-amber/60 text-amber",
    alarm: "border-alarm/70 bg-alarm/10 text-alarm",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-[3px] font-mono text-[9px] leading-none tracking-[0.16em] uppercase ${cls}`}>{children}</span>;
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
