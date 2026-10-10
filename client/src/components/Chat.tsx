import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon, Module } from "./ui";

interface Msg {
  who: "you" | "baby" | "system";
  text: string;
}

const HANDLE_KEY = "bb.handle";
const readHandle = () => {
  try {
    return localStorage.getItem(HANDLE_KEY) ?? "";
  } catch {
    return "";
  }
};

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
      else setMsgs((m) => [...m, { who: "baby", text: body.reply }]);
    } catch {
      setMsgs((m) => [...m, { who: "system", text: "connection lost" }]);
    } finally {
      setBusy(false);
    }
  }

  const status = paused ? "Paused by operator" : canChat ? (stage === "NEONATAL" ? "Vocabulary limited" : "Channel open") : "Locked until birth";

  return (
    <Module id="chat" index="05" title="Talk to the specimen" meta={status}>
      <div className="panel flex h-full flex-col overflow-hidden">
        <div ref={box} className="scroll-thin min-h-[300px] flex-1 space-y-3 overflow-y-auto p-4 sm:max-h-[420px]" aria-live="polite">
          {msgs.length === 0 && (
            <div className="grid h-full min-h-[240px] place-items-center text-center">
              <div className="max-w-xs">
                <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full border border-line2 text-dim">
                  <Icon name={canChat ? "chat" : "lock"} />
                </div>
                <div className="font-mono text-[11px] tracking-[0.2em] text-silver uppercase">
                  {paused ? "Channel paused" : canChat ? "Intercom open" : "Intercom locked"}
                </div>
                <p className="mt-1.5 text-[13px] text-dim">
                  {paused ? "An operator has paused chat." : canChat ? "Say something. It is very new and understands less than it thinks." : "The specimen can't speak before it's born."}
                </p>
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`fade-up flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-[3px] border px-3 py-2 ${
                  m.who === "you" ? "border-line2 bg-white/[0.04] text-silver" : m.who === "baby" ? "border-white/40 bg-white/[0.07] text-ink" : "border-alarm/40 bg-alarm/[0.06] text-alarm"
                }`}
              >
                <div className="mb-1 font-mono text-[9px] tracking-[0.2em] text-mute uppercase">{m.who === "you" ? "You" : m.who === "baby" ? "Specimen" : "System"}</div>
                <div className="text-[14px] leading-snug">{m.text}</div>
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-[3px] border border-white/30 px-3 py-2 font-mono text-[12px] text-dim">
                <span className="blink">●</span> thinking
              </div>
            </div>
          )}
        </div>
        <form onSubmit={send} className="grid gap-2 border-t border-line p-3 sm:grid-cols-[150px_1fr_auto]">
          <label className="sr-only" htmlFor="chat-handle">
            Your X handle (optional)
          </label>
          <input id="chat-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle (optional)" maxLength={16} className="field" autoComplete="off" />
          <label className="sr-only" htmlFor="chat-msg">
            Message
          </label>
          <input id="chat-msg" value={text} onChange={(e) => setText(e.target.value)} placeholder={canChat ? "Message the specimen" : "Locked"} disabled={!canChat} maxLength={280} className="field min-w-0" autoComplete="off" />
          <button disabled={!canChat || busy || !text.trim()} className="btn btn-solid">
            <Icon name="send" className="h-3.5 w-3.5" /> Send
          </button>
        </form>
      </div>
    </Module>
  );
}
