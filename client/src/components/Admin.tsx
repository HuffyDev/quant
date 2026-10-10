import { useEffect, useState } from "react";
import { useStore } from "../store";

const KEY = "root.admin";
const read = () => {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

interface ArcAdmin {
  startAt: string | null;
  spacingS: number;
  paused: boolean;
  beats: { id: string; index: number; directive: string; requiredText: string | null; dueAt: string | null; status: string; error: string | null }[];
}

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { hour12: false }) : "—");

export function Admin() {
  const [token, setToken] = useState(read);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ageS: number | null; queue: unknown; arc: ArcAdmin; probes?: { enabled: boolean; spentTodayUsd: number; budgetUsd: number; streamKeySet: boolean } } | null>(null);
  const state = useStore((s) => s.state);
  const [launchAt, setLaunchAt] = useState("");
  const [mint, setMint] = useState("");
  const [skip, setSkip] = useState("");
  const [arcStart, setArcStart] = useState("");
  const [arcSpacingMin, setArcSpacingMin] = useState("");
  const [simSpacing, setSimSpacing] = useState("15");

  async function call(path: string, body?: unknown) {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      /* ignore */
    }
    const res = await fetch(`/admin/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setLog((l) => [`${res.status} ${path} ${JSON.stringify(json).slice(0, 200)}`, ...l].slice(0, 30));
    return json;
  }

  useEffect(() => {
    if (!token) return;
    const poll = async () => {
      const r = await fetch("/admin/api/status", { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) setStatus(await r.json());
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [token]);

  const f = state?.flags;
  const toggle = (k: string, v: boolean) => call("/flags", { [k]: v });
  const arc = status?.arc;
  const launched = state?.ageS !== null && state?.ageS !== undefined && state.ageS >= 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 font-mono text-[12px]">
      <h1 className="section-title mb-4">Operator Console · ROOT</h1>
      <p className="mb-4 text-dim">Every action here is logged publicly as a HUMAN event.</p>
      <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" className="mb-6 w-full rounded-sm border border-line bg-black px-2 py-2 text-ink" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Kill switches">
          <Btn danger={!f?.xPaused} onClick={() => toggle("xPaused", !f?.xPaused)}>{f?.xPaused ? "RESUME X POSTING" : "PAUSE X POSTING"}</Btn>
          <Btn danger={!f?.chatPaused} onClick={() => toggle("chatPaused", !f?.chatPaused)}>{f?.chatPaused ? "RESUME CHAT" : "PAUSE CHAT"}</Btn>
          <Btn danger={!f?.treasuryFrozen} onClick={() => toggle("treasuryFrozen", !f?.treasuryFrozen)}>{f?.treasuryFrozen ? "UNFREEZE TREASURY" : "FREEZE TREASURY"}</Btn>
          <Btn danger={!!f?.autonomyEnabled} onClick={() => toggle("autonomyEnabled", !f?.autonomyEnabled)}>{f?.autonomyEnabled ? "DISABLE AUTONOMOUS LOOP" : "ENABLE AUTONOMOUS LOOP"}</Btn>
        </Card>

        <Card title="Stream self-probes (/stream only)">
          <Btn danger={!!status?.probes?.enabled} onClick={() => toggle("probesEnabled", !status?.probes?.enabled)}>{status?.probes?.enabled ? "DISABLE SELF-PROBES" : "ENABLE SELF-PROBES"}</Btn>
          <div className="text-dim">
            spend today ${status?.probes ? status.probes.spentTodayUsd.toFixed(3) : "—"} of ${status?.probes?.budgetUsd ?? "—"} · STREAM_KEY {status?.probes?.streamKeySet ? "set" : "NOT SET (/stream disabled)"}
          </div>
        </Card>

        <Card title="Launch (final beat: root access granted + CA)">
          <div className="text-dim">CA: {state?.token.mint ?? "not set"}</div>
          <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="TOKEN_MINT (set before launch)" className="w-full rounded-sm border border-line bg-black px-2 py-1.5 text-ink" />
          <Btn onClick={() => call("/launch", { tokenMint: mint })}>SET TOKEN_MINT</Btn>
          <input value={launchAt} onChange={(e) => setLaunchAt(e.target.value)} placeholder="ISO UTC e.g. 2026-10-10T18:00:00Z (empty = now)" className="w-full rounded-sm border border-line bg-black px-2 py-1.5 text-ink" />
          <Btn danger onClick={() => call("/launch", { launchAt: launchAt || "now" })}>{launchAt ? "SET LAUNCH_TIMESTAMP" : "LAUNCH NOW"}</Btn>
        </Card>

        <Card title="Pre-launch arc" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input value={arcStart} onChange={(e) => setArcStart(e.target.value)} placeholder="start: ISO UTC (empty = now)" className="rounded-sm border border-line bg-black px-2 py-1.5 text-ink" />
            <input value={arcSpacingMin} onChange={(e) => setArcSpacingMin(e.target.value)} placeholder={`spacing minutes (now ${arc ? arc.spacingS / 60 : "?"})`} inputMode="decimal" className="rounded-sm border border-line bg-black px-2 py-1.5 text-ink" />
            <Btn
              onClick={() =>
                call("/arc", {
                  startAt: arcStart || "now",
                  ...(arcSpacingMin ? { spacingS: Math.round(Number(arcSpacingMin) * 60) } : {}),
                })
              }
            >
              SCHEDULE ARC
            </Btn>
          </div>
          <div className="flex flex-wrap gap-2">
            {arcSpacingMin && <Btn onClick={() => call("/arc", { spacingS: Math.round(Number(arcSpacingMin) * 60) })}>SET SPACING ONLY</Btn>}
            <Btn danger={!arc?.paused} onClick={() => call("/arc", { paused: !arc?.paused })}>{arc?.paused ? "RESUME ARC" : "PAUSE ARC"}</Btn>
            <Btn danger onClick={() => call("/arc", { startAt: null })}>UNSCHEDULE ARC</Btn>
          </div>
          <div className="text-dim">
            start {fmtTime(arc?.startAt ?? null)} · every {arc ? `${arc.spacingS / 60} min` : "—"} {arc?.paused ? "· PAUSED" : ""} {launched ? "· launched (remaining beats skipped)" : ""}
          </div>
          {arc && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-mute">
                  <tr>
                    <th className="py-1 pr-2">#</th>
                    <th className="pr-2">due</th>
                    <th className="pr-2">status</th>
                    <th className="pr-2">directive</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {arc.beats.map((b) => (
                    <tr key={b.id} className="border-t border-line align-top">
                      <td className="py-1 pr-2 text-dim">{b.index + 1}</td>
                      <td className="pr-2 whitespace-nowrap text-dim">{fmtTime(b.dueAt)}</td>
                      <td className={`pr-2 ${b.status === "failed" ? "text-alarm" : b.status === "done" ? "text-ice" : "text-dim"}`}>
                        {b.status}
                        {b.error ? ` (${b.error})` : ""}
                      </td>
                      <td className="pr-2 text-silver">
                        {b.directive}
                        {b.requiredText && <span className="text-ice"> · must say “{b.requiredText}”</span>}
                      </td>
                      <td>
                        {b.status === "pending" && b.id !== "root_access" && (
                          <button className="text-alarm" onClick={() => call("/arc/skip", { beatId: b.id })}>
                            skip
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Timeline">
          <select value={skip} onChange={(e) => setSkip(e.target.value)} className="w-full rounded-sm border border-line bg-black px-2 py-1.5 text-ink">
            <option value="">— step —</option>
            {state?.timeline
              .filter((s) => s.wired && !s.fired)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
          <Btn danger onClick={() => skip && call("/skip-step", { stepId: skip })}>FORCE-SKIP STEP</Btn>
        </Card>

        {state?.mode === "sim" && (
          <Card title="Simulation">
            <div className="flex gap-2">
              <input value={simSpacing} onChange={(e) => setSimSpacing(e.target.value)} inputMode="numeric" className="w-20 rounded-sm border border-line bg-black px-2 py-1.5 text-ink" aria-label="seconds between beats" />
              <Btn onClick={() => call("/sim/run-arc", { spacingS: Number(simSpacing) || 15 })}>RUN PRE-LAUNCH ARC (s/beat)</Btn>
            </div>
            <Btn onClick={() => call("/sim/run-first-hour", {})}>RUN FULL FIRST HOUR (×{state.simSpeed})</Btn>
            <Btn danger onClick={() => call("/sim/reset", {})}>RESET TO DORMANT</Btn>
          </Card>
        )}
      </div>

      {status && <pre className="panel mt-6 max-h-64 overflow-auto p-3 text-[11px] text-dim">{JSON.stringify({ ageS: status.ageS, queue: status.queue }, null, 2)}</pre>}
      <div className="panel mt-6 max-h-64 overflow-auto p-3 text-[11px] text-dim">
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

const Card = ({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) => (
  <div className={`panel flex flex-col gap-2 p-3 ${className}`}>
    <div className="hud-label">{title}</div>
    {children}
  </div>
);

const Btn = ({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) => (
  <button onClick={onClick} className={`rounded-sm border px-3 py-1.5 text-left text-[11px] ${danger ? "border-alarm/60 text-alarm" : "border-ice/60 text-ice"}`}>
    {children}
  </button>
);
