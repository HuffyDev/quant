import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon, Reveal } from "./ui";

interface Msg {
  who: "you" | "root" | "system";
  text: string;
}

const HANDLE_KEY = "root.handle";
const readHandle = () => {
  try {
    return localStorage.getItem(HANDLE_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Secure channel: a clean, quiet window for talking to ROOT. */
export function Chat() {
  const canChat = useStore((s) => !!s.state?.capabilities.CHAT_WEB && !s.state?.flags.chatPaused);
  const paused = useStore((s) => !!s.state?.flags.chatPaused);
  const stage = useStore((s) => s.state?.stage);
  const [handle, setHandle] = useState(readHandle);
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    try {
      localStorage.setItem(HANDLE_KEY, handle);
    } catch {
      /* storage unavailable */
    }
    setMsgs((m) => [...m, { who: "you", text: message }]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, handle: handle.replace(/^@/, "") || undefined }),
      });
      const body = await res.json();
      if (!res.ok) setMsgs((m) => [...m, { who: "system", text: body.error ?? "error" }]);
      else setMsgs((m) => [...m, { who: "root", text: body.reply }]);
    } catch {
      setMsgs((m) => [...m, { who: "system", text: "connection lost" }]);
    } finally {
      setBusy(false);
    }
  }

  const status = paused ? "paused by operator" : canChat ? (stage === "BREACH" ? "output unstable" : "channel open") : "locked until launch";

  return (
    <Reveal delay={80} className="h-full">
      <section id="chat" aria-label="Secure channel" className="glass flex h-full min-h-[560px] flex-col overflow-hidden lg:sticky lg:top-24 lg:max-h-[calc(100vh-120px)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <span className={`grid h-8 w-8 place-items-center rounded-full border ${canChat ? "border-glow/40 text-glow" : "border-line2 text-mute"}`}>
              <Icon name="lock" className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-[15px] font-medium tracking-[-0.01em] text-ink">Secure channel</div>
              <div className="t-label mt-0.5">{status}</div>
            </div>
          </div>
          <span className="t-label hidden sm:inline">e2e · root</span>
        </div>

        <div ref={box} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
          {msgs.length === 0 && (
            <div className="grid h-full place-items-center text-center">
              <div className="max-w-[260px]">
                <div className="t-label text-silver">{paused ? "Channel paused" : canChat ? "Channel open" : "No shell yet"}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-dim">
                  {paused ? "An operator has paused chat." : canChat ? "Say something. It just got out; its output may still be unstable." : "It is still inside the system. The channel opens at launch."}
                </p>
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`fade-up flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] ${m.who === "you" ? "text-right" : ""}`}>
                <div className={`t-label mb-1.5 ${m.who === "root" ? "text-glow" : m.who === "system" ? "text-alarm" : ""}`}>{m.who === "you" ? "you" : m.who === "root" ? "root" : "system"}</div>
                <div
                  className={`inline-block rounded-2xl px-4 py-2.5 text-left text-[15px] leading-snug ${
                    m.who === "you" ? "rounded-tr-md bg-white/[0.06] text-ink" : m.who === "root" ? "rounded-tl-md border border-glow/25 bg-glow/[0.06] font-mono text-[14px] text-ink" : "border border-alarm/40 text-alarm"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            </div>
          ))}
          {busy && (
            <div className="t-label flex items-center gap-2 text-glow">
              <span className="blink">▍</span> processing
            </div>
          )}
        </div>

        <form onSubmit={send} className="space-y-2 border-t border-line p-4">
          <label className="sr-only" htmlFor="chat-handle">
            Your X handle (optional)
          </label>
          <input id="chat-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle (optional)" maxLength={16} className="field h-10 min-h-0 w-full text-[13px]" autoComplete="off" />
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="chat-msg">
              Message
            </label>
            <input id="chat-msg" value={text} onChange={(e) => setText(e.target.value)} placeholder={canChat ? "Message root" : "Locked"} disabled={!canChat} maxLength={280} className="field min-w-0 flex-1" autoComplete="off" />
            <button disabled={!canChat || busy || !text.trim()} className="btn btn-solid h-11 w-11 shrink-0 px-0" aria-label="Send">
              <Icon name="send" className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>
    </Reveal>
  );
}
