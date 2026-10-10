import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "./store";
import { Hero } from "./components/Hero";
import { Terminal, SourceBadge } from "./components/Terminal";
import { Chat } from "./components/Chat";
import { ActionLog, Escalation, Mind, Token, Treasury } from "./components/Sections";
import { Admin } from "./components/Admin";
import { Icon, Module } from "./components/ui";
import { Boot } from "./boot";

const Stream = lazy(() => import("./stream/Stream"));
const Core = lazy(() => import("./core/Core"));

const NAV: [string, string][] = [
  ["Root", "#top"],
  ["Core", "/core"],
  ["Chat", "#chat"],
  ["Activity", "#activity"],
  ["Treasury", "#treasury"],
  ["Token", "#token"],
];

function Header() {
  const connected = useStore((s) => s.connected);
  const xHandle = useStore((s) => s.state?.token.xHandle);
  const mode = useStore((s) => s.state?.mode);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [open]);

  const links: [string, string][] = [...NAV, ["X", xHandle ? `https://x.com/${xHandle}` : "#token"]];
  const ext = (h: string) => h.startsWith("http");

  return (
    <>
      <header className={`fixed inset-x-0 top-0 z-50 transition-[background,border-color,backdrop-filter] duration-300 ${scrolled ? "border-b border-line bg-black/70 backdrop-blur-xl" : "border-b border-transparent"}`}>
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-10">
          <a href="#top" className="group flex items-center gap-3" aria-label="ROOT — top">
            <img src="/favicon-32.png" alt="" className="h-6 w-6 rounded-[5px] transition-[filter] duration-300 group-hover:brightness-150" />
            <span className="font-display text-[17px] font-semibold tracking-[-0.03em] text-white">ROOT</span>
          </a>
          <nav aria-label="Sections" className="ml-6 hidden items-center gap-7 lg:flex">
            {links.map(([label, href]) => (
              <a key={label} href={href} target={ext(href) ? "_blank" : undefined} rel="noreferrer" className="link font-mono text-[12px] tracking-[0.06em] uppercase">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {mode === "sim" && (
              <span className="pill text-dim" title="Simulated data, accelerated time">
                Sim
              </span>
            )}
            <span className={`pill ${connected ? "text-ink" : "border-alarm/50 text-alarm"}`} aria-live="polite">
              <span className={`dot ${connected ? "dot-live" : ""}`} />
              {connected ? "Live" : "Offline"}
            </span>
            <button className="btn h-10 w-10 px-0 lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="nav-sheet" onClick={() => setOpen((v) => !v)}>
              <Icon name={open ? "close" : "menu"} />
            </button>
          </div>
        </div>
      </header>
      {open && (
        <nav id="nav-sheet" aria-label="Sections" className="nav-sheet lg:hidden">
          <ul className="flex h-full flex-col justify-center gap-1 px-6">
            {links.map(([label, href], i) => (
              <li key={label} className="fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                <a href={href} target={ext(href) ? "_blank" : undefined} rel="noreferrer" onClick={() => setOpen(false)} className="flex items-baseline justify-between border-b border-line py-4 text-[34px] font-medium tracking-[-0.04em] text-ink transition-colors hover:text-glow">
                  {label}
                  <span className="t-label tnum">{String(i + 1).padStart(2, "0")}</span>
                </a>
              </li>
            ))}
          </ul>
          <button className="btn absolute right-4 top-3 h-10 w-10 px-0" aria-label="Close menu" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </nav>
      )}
    </>
  );
}

const Wrap = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 ${className}`}>{children}</div>;

function Site() {
  const prelaunch = useStore((s) => !s.state || s.state.ageS === null || s.state.ageS < 0);
  return (
    <>
      <Boot prelaunch={prelaunch} />
      <a href="#activity" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black">
        Skip to live console
      </a>
      <Header />
      <main>
        <Hero />
        <Wrap className="space-y-28 py-24 sm:space-y-36 sm:py-32">
          <Module id="activity" index="01" title="Activity" meta="every event · live">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
                <Terminal />
                <ActionLog />
              </div>
              <div className="min-w-0 lg:col-span-4">
                <Chat />
              </div>
            </div>
          </Module>
          <Treasury />
          <Escalation />
          <Mind />
          <Token />
        </Wrap>
      </main>
      <footer className="border-t border-line">
        <Wrap className="grid gap-8 py-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="t-label mb-4">Event sources</div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {(["ROOT", "SYSTEM", "GUARDIAN", "HUMAN"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-2.5 text-[13px] text-dim">
                  <SourceBadge source={s} />
                  {{ ROOT: "AI-generated", SYSTEM: "automation", GUARDIAN: "risk engine", HUMAN: "operator override" }[s]}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-mute lg:col-span-5 lg:text-right">
            ROOT is fiction. It never hacked anything real; it only touches its own treasury, through the Guardian.
            <br />
            Not financial advice. It does not predict prices.
          </p>
        </Wrap>
      </footer>
      <div className="grain" aria-hidden />
    </>
  );
}

export function App() {
  if (location.pathname.startsWith("/admin")) return <Admin />;
  if (location.pathname.startsWith("/core"))
    return (
      <Suspense fallback={null}>
        <Core />
        <div className="grain" aria-hidden />
      </Suspense>
    );
  if (location.pathname.startsWith("/stream"))
    return (
      <Suspense fallback={null}>
        <Stream />
      </Suspense>
    );
  return <Site />;
}
