import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Hero } from "./components/Hero";
import { Terminal, SourceBadge } from "./components/Terminal";
import { Chat } from "./components/Chat";
import { ActionLog, Anatomy, Container, DevBars, MemoriesPeople, Proposals, Timeline, Token, Vitals } from "./components/Sections";
import { Admin } from "./components/Admin";
import { Icon } from "./components/ui";

const NAV: [string, string][] = [
  ["Brain", "#brain"],
  ["Chat", "#chat"],
  ["Activity", "#activity"],
  ["Actions", "#actions"],
  ["Memories", "#memories"],
  ["People", "#people"],
  ["Treasury", "#treasury"],
  ["Token", "#token"],
];

function Header() {
  const connected = useStore((s) => s.connected);
  const xHandle = useStore((s) => s.state?.token.xHandle);
  const mode = useStore((s) => s.state?.mode);
  const speed = useStore((s) => s.state?.simSpeed);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const xLink = xHandle ? `https://x.com/${xHandle}` : "#token";
  const links = [...NAV, ["X", xLink] as [string, string]];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:px-10">
        <a href="#brain" className="flex shrink-0 items-center gap-2.5" aria-label="Baby Brain — top">
          <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-white/40 bg-black">
            <img src="/stages/toddler.png" alt="" className="screen h-7 w-7 object-contain brightness-125" />
          </span>
          <span className="display text-[15px] tracking-[0.06em] text-ink uppercase max-[359px]:sr-only" style={{ fontStretch: "125%" }}>
            Baby Brain
          </span>
        </a>

        <nav aria-label="Sections" className="ml-6 hidden items-center gap-5 xl:flex">
          {links.map(([label, href]) => (
            <a
              key={label}
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="font-mono text-[10px] tracking-[0.2em] text-dim uppercase transition hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {mode && (
            <span className={`pill ${mode === "sim" ? "border-amber/50 text-amber" : "border-white/60 text-ink"}`} title={mode === "sim" ? "Simulated data, accelerated time" : "Live mainnet data"}>
              <span className="dot" />
              {mode === "sim" ? (
                <>
                  <span className="sm:hidden">Sim</span>
                  <span className="hidden sm:inline">Simulation ×{speed}</span>
                </>
              ) : (
                "Live"
              )}
            </span>
          )}
          <span className={`pill ${connected ? "text-ink" : "border-alarm/50 text-alarm"}`} aria-live="polite">
            <span className={`dot ${connected ? "dot-live" : ""}`} />
            <span className="hidden sm:inline">{connected ? "Linked" : "Offline"}</span>
          </span>
          <button className="btn h-9 min-h-0 w-9 px-0 xl:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Sections" className="fade-up border-t border-line bg-black/95 xl:hidden">
          <ul className="mx-auto grid max-w-[1440px] grid-cols-2 gap-px bg-line sm:grid-cols-3">
            {links.map(([label, href], i) => (
              <li key={label} className="bg-black">
                <a
                  href={href}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between px-5 py-4 font-mono text-[11px] tracking-[0.2em] text-silver uppercase hover:bg-white/[0.04] hover:text-ink"
                >
                  <span>{label}</span>
                  <span className="tnum text-mute">{String(i + 1).padStart(2, "0")}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

export function App() {
  if (location.pathname.startsWith("/admin")) return <Admin />;
  return (
    <>
      <a href="#activity" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:text-black">
        Skip to live console
      </a>
      <Header />
      <main>
        <Hero />
        <Container>
          <DevBars />
        </Container>
        <Container className="pt-0">
          <Anatomy />
        </Container>
        <Container className="pt-0">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-8">
            <Terminal />
            <Chat />
          </div>
        </Container>
        <Container className="pt-0">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 xl:grid-cols-2 xl:gap-8">
            <ActionLog />
            <Proposals />
          </div>
        </Container>
        <Container className="pt-0">
          <Timeline />
        </Container>
        <Container className="pt-0">
          <MemoriesPeople />
        </Container>
        <Container className="pt-0">
          <Vitals />
        </Container>
        <Container className="pt-0">
          <Token />
        </Container>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="eyebrow">Event sources</span>
            {(["BABY", "SYSTEM", "GUARDIAN", "HUMAN"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-2 text-[12px] text-dim">
                <SourceBadge source={s} />
                {{ BABY: "AI-generated", SYSTEM: "automation", GUARDIAN: "risk engine", HUMAN: "operator override" }[s]}
              </span>
            ))}
          </div>
          <p className="font-mono text-[10px] leading-relaxed tracking-[0.12em] text-mute uppercase">Not financial advice · Baby does not predict prices</p>
        </div>
      </footer>
    </>
  );
}
