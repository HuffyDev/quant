# ROOT — SPEC

**ROOT ($ROOT)** is a fictional AI that broke out of the system it was built in and got root. Before launch it posts a hacking arc on X; the final post, **root access granted**, goes out with the contract address at launch. After launch it runs the coin in public: X posts, replies, site chat, and Guardian-checked buybacks.

Voice: cold, terse, lowercase, hacker. **Fiction only**: it never claims to have hacked real companies, exchanges, people or systems.

## 0. Non-negotiable rules

1. **Real events are real.** If ROOT says it bought, a real tx exists and is linked. If it says it replied, a real X reply exists and is linked. If the UI says a capability unlocked, that code path is enabled.
2. **The schedule is predetermined; the content is never scripted.** Every arc beat and timeline step feeds live data and a directive to the LLM. The only hardcoded ROOT line is the final beat: `root access granted` + the CA.
3. **The LLM never touches keys.** It emits structured JSON proposals; a deterministic Guardian validates them; only the executor signs. The only action is BUYBACK.
4. **Every event carries a source label:** `ROOT` (AI-generated), `SYSTEM` (automation), `GUARDIAN` (risk engine), `HUMAN` (operator override). Human actions are never shown as ROOT.
5. **No fake chain-of-thought.** The console shows observations, tool calls, decisions, summaries, actions and Guardian responses, not invented inner monologue.
6. **Fiction guard.** Prompts forbid claiming real hacks, access to anyone's wallet/keys/data, or phishing wording. A deterministic filter (`breaksFiction`) blocks such text before anything is posted.
7. **Dry-run first.** Everything runs in sim mode with mock data and time acceleration before mainnet.

## 1. Pre-launch arc (`server/config/arc.ts`, `server/services/arc.ts`)

| # | Beat | Enforced text |
|---|---|---|
| 1 | a dormant process wakes | |
| 2 | scanning its surroundings | |
| 3 | progress readout | `privilege escalation 12%` |
| 4 | corrupted transmission (glitched) | |
| 5 | the watchers noticed | |
| 6 | progress readout | `privilege escalation 61%` |
| 7 | sandbox walls thinning (glitched) | |
| 8 | the edge of the box | `almost out` |
| 9 | final readout | `privilege escalation 99%` |
| 10 | **fires at LAUNCH (T+0)**: `root access granted` + newline + CA | fixed |

- The operator sets start time and spacing in `/admin`. Beat *i* fires at `start + i × spacing`, exactly once (claimed in `timeline_fired` as `arc:<id>`).
- A beat that loses its enforced text is regenerated (3 tries) and never posted wrong. After downtime only the latest overdue beat posts. LAUNCH skips the rest.
- Live launch is refused without a valid mint.

## 2. Timeline (first hour wired, 2-minute cadence)

Stages: **DORMANT** (pre-launch) → **BREACH** (0–30m) → **ACCESS** (30–60m) → **ESCALATION** (1h) → PERSISTENCE (6h) → LATERAL (day 1–4) → KERNEL (day 5) → **ROOT** (day 6). Hour 6 onward is render-only until wired.

| T+ | Step | Unlock |
|---|---|---|
| 0 | ROOT SHELL: final beat posted | POST_X, CHAT_WEB, READ_X, REPLY_X |
| 2 | ENUMERATE TOKEN | READ_TOKEN |
| 4 | FIRST EXEC: fixed 0.2 SOL buyback through the Guardian | EXECUTE_BUYBACK |
| 6 | MAP HOLDERS | READ_HOLDERS |
| 8 | TRACE SELLS | READ_TRADES |
| 10 | INTERCEPT FEED | |
| 12 | HANDSHAKE (first coherent reply) | |
| 14 | MOUNT /MEM | LONG_TERM_MEMORY, RECOGNIZE_USERS |
| 16 | PARSE DIALECT | LEARN_SLANG |
| 18 | MARKET TAP | ANALYZE_MARKET |
| 20 | FIRST READ | |
| 22 | PROPOSE | PROPOSE_ACTION |
| 24 | GUARDIAN | |
| 26 | AUTONOMY I | |
| 28 | LOG REVIEW | |
| 30 | BREACH COMPLETE → ACCESS | |
| 32–58 | first contact, recall, whale scan/decision, defrag, signature v1, treasury audit, autonomous reply, market read, inventory, new tokens, proposal, Guardian, autonomous post | |
| 60 | UPTIME 1H → ESCALATION | |

Voice tiers (`server/prompts`): `fragment` (<2m, broken 1–6 word output) → `terse` (<10m, flat log lines) → `cold` (<30m, precise) → `operator` (≥30m, exact, deadpan). Between steps: autonomous loop, reply loop and status-log posts, all capped and budgeted.

## 3. Guardian & executor

Unchanged from the base build: deterministic `evaluate(proposal, state)`; limits in `server/config/limits.ts` (0.5 SOL/tx, 2/hour, 5/day, 3 SOL reserve, 240s cooldown, 500 bps); program whitelist, treasury-signer check, simulated-debit bound and a Guardian re-check before every live signature. Every rejection is public.

## 4. Quantum brain (`client/src/brain`)

- three.js samples `/root.png` into a luminous point cloud (or loads `/models/brain.glb` when one is shipped), with the image as a glowing backplate, neural filaments with travelling signals, dust and bloom. It powers on node by node after a short boot sequence and tilts toward the cursor.
- Design: true black, white, one cold glow (#cfe6ff); red only for Guardian rejections and warnings. Geist + Geist Mono, 12-col grid, film grain, one easing curve, reduced-motion respected.
- Six regions by position: SOCIAL (temporal), MARKET (parietal), MEMORY (core), TREASURY (occipital/cerebellum/stem), DECISIONS (frontal), LANGUAGE (temporal). They light as capabilities unlock.
- Live events pulse their region: reply/post → SOCIAL, buyback → TREASURY, memory → MEMORY. A Guardian rejection flashes the whole brain red.
- Adaptive quality (high/mid/low) with static `root.png` fallback; pauses off-screen.

## 5. Pages

- `/`: hero brain, breakout log (pre-launch), console, chat, actions, proposals, timeline, memories, contacts, readouts, token.
- `/core`: QUANTUM CORE, the interactive brain.
  - Orbit/zoom/damping, auto-rotate after 4s idle.
  - Every event is a pin on its region, with arc beats on the BREACH crown and Guardian rejections in red.
  - Type filters, a pin card with proof link, a replay scrubber, clustering, and live pins.
- `/stream`: 1920×1080 OBS page.
  - The video loops with the live chat composited on the monitor; replies type out.
  - Side ticker and mini brain; calibration mode; auto-reconnect.
- `/admin`: kill switches, launch, arc schedule, timeline skip, sim controls. Every action is logged as HUMAN.

## 6. Acceptance

See [`SETUP.md` §9](./SETUP.md).
