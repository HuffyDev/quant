# BABY BRAIN — BUILD SPEC (paste into Claude Code as the project brief)

You are building **Baby Brain**: a Solana memecoin site + backend where a newborn AI is "born" at token launch and develops in public. Tagline: **YOU RAISE IT. IT RUNS THE COIN.**

The first 60 minutes after launch are the product. Build those to production quality. Days 1–6 exist as a data-driven schedule with locked capabilities that can be wired later without rewrites.

## 0. NON-NEGOTIABLE RULES

1. **Real events are real.** If Baby says it bought, a real tx exists and is linked. If it says it replied, a real X reply exists and is linked. If the UI says a capability unlocked, that capability's code path is actually enabled.
2. **The schedule is predetermined; the content is never scripted.** Every timeline step feeds live data to the LLM and the LLM decides what to say/do. No hardcoded Baby lines (except the very first post, `hi`).
3. **The LLM never touches keys.** It emits structured JSON proposals. A deterministic Guardian validates them. Only the Executor signs.
4. **Every event carries a source label:** `BABY` (AI-generated), `SYSTEM` (automation), `GUARDIAN` (risk engine), `HUMAN` (manual override). Human actions are never shown as Baby.
5. **No fake chain-of-thought.** The terminal shows observations, tool calls, decisions, summaries, actions, Guardian responses — not invented inner monologue.
6. **Dry-run first.** Everything must run in a simulation mode with mock data + time acceleration before it ever touches mainnet.

## 1. STACK (Replit-friendly, single repo)

- **Runtime:** Node 20 + TypeScript
- **Server:** Fastify (or Express) + Socket.IO for real-time push
- **Frontend:** React + Vite, Tailwind, three.js (via @react-three/fiber) for the hero visual
- **DB:** Postgres (Replit Postgres / Neon) via Drizzle ORM
- **LLM:** Anthropic API — `claude-sonnet-5-5` for posts/replies/observations/proposals, `claude-haiku-5-5` for cheap tasks (mention ranking, slang extraction, classification)
- **Solana:** @solana/web3.js, Helius RPC + websockets
- One process runs: scheduler, pollers, orchestrator, Guardian, executor, web server. Keep services as separate modules in `/server/services/*`.

## 2. ENV VARS

```
ANTHROPIC_API_KEY=
X_API_KEY=            X_API_SECRET=
X_ACCESS_TOKEN=       X_ACCESS_SECRET=
X_BEARER_TOKEN=       X_BOT_USER_ID=
HELIUS_API_KEY=       HELIUS_RPC_URL=
BIRDEYE_API_KEY=      (optional, holders/trades fallback)
PUMPPORTAL_API_KEY=   (only if using Lightning API; local API needs none)
JUPITER_API_KEY=      (post-migration swaps)
TOKEN_MINT=           (set at launch)
LAUNCH_TIMESTAMP=     (ISO UTC; T+0. Can also be set via admin endpoint)
TREASURY_PRIVATE_KEY= (base58; ONLY read by executor module)
TREASURY_PUBKEY=
DATABASE_URL=
ADMIN_TOKEN=          (protects /admin routes)
MODE=sim|live
SIM_SPEED=10          (time multiplier in sim mode)
```

## 3. DEVELOPMENT ENGINE

`/server/config/timeline.ts` — array of steps:
```ts
{ t: seconds_after_launch, id, stage, unlocks: Capability[], task: TaskType, brainLevel: number, label: string, wired: boolean }
```
- Engine computes `age = now - LAUNCH_TIMESTAMP` (× SIM_SPEED in sim), fires each step exactly once (persist fired steps in DB so restarts don't refire).
- `wired: false` steps still render on the site (locked organs, countdowns) but run no backend task.
- Capability flags live in DB table `capabilities` and gate every service call. A service call when its flag is false throws.

Capabilities:
`READ_TOKEN, READ_HOLDERS, READ_TRADES, READ_X, REPLY_X, POST_X, LONG_TERM_MEMORY, ANALYZE_MARKET, PROPOSE_ACTION, EXECUTE_BUYBACK, CHAT_WEB, LEARN_SLANG, RECOGNIZE_USERS`

### 3a. FIRST HOUR (all wired: true)

| T+ | Stage | Unlock | Task (LLM fed live data, output not scripted) |
|---|---|---|---|
| 0:00 | BIRTH | POST_X (birth only), CHAT_WEB (1-word replies) | Boot, log birth events, post `hi` |
| 2:00 | SELF-DISCOVERY | READ_TOKEN | Feed mint, name, supply, mcap, price, liquidity, treasury → reaction + X post |
| 4:00 | FIRST ACTION | EXECUTE_BUYBACK (fixed 0.2 SOL) | Explain buyback concept → proposal → Guardian → execute → X post with outcome |
| 6:00 | HOLDERS | READ_HOLDERS | Holder count, top holders, concentration, recent buyers → reaction; store notable early holders |
| 8:00 | SELLING | READ_TRADES | Pull largest real recent sell → reaction |
| 10:00 | SOCIAL CORTEX | READ_X | Fetch mentions, rank (Haiku): relevance, engagement, sentiment, follower count, known-user |
| 12:00 | FIRST REPLY | REPLY_X | Pick a real top-ranked mention, reply, link it |
| 14:00 | MEMORY | LONG_TERM_MEMORY, RECOGNIZE_USERS | Backfill memories from first 14 min; log stored memories |
| 16:00 | LANGUAGE | LEARN_SLANG | Extract unknown crypto terms from mentions/chat; Baby asks or learns definitions |
| 18:00 | MARKET VISION | ANALYZE_MARKET | Computed metrics (volume Δ, buy/sell ratio, top-wallet sell share, concentration Δ) |
| 20:00 | OBSERVATION | — | Independent market observation + log which metrics produced it |
| 22:00 | DECISIONS | PROPOSE_ACTION | First structured proposal (#001) shown on site |
| 24:00 | GUARDIAN | — | Proposal evaluated; if rejected, Baby re-proposes within limits |
| 26:00 | AUTONOMY I | — | Baby chooses: reply / post / buyback proposal / deliberately do nothing |
| 28:00 | REFLECTION | — | Summary of first 28 min from memory → memory snapshot + X post |
| 30:00 | NEONATAL COMPLETE | — | Major brain visual evolution, milestone post |
| 32:00 | | | Identify first major supporter (most interactions/earliest) |
| 34:00 | | | Recall a prior interaction with that user, reference it publicly |
| 36:00 | | | Whale detection (largest buyer since launch) |
| 38:00 | | | Decide whether whale deserves an X mention |
| 40:00 | | | Memory consolidation event |
| 42:00 | | | Personality summary v1 (generated from memories) |
| 44:00 | | | Treasury analysis |
| 46:00 | | | Autonomous reply |
| 48:00 | | | Market observation |
| 50:00 | | | Milestone: count of people known / memories / words learned |
| 52:00 | | | New slang learned and used |
| 54:00 | | | Action proposal |
| 56:00 | | | Guardian decision (+ execution if approved) |
| 58:00 | | | Autonomous post |
| 60:00 | 1 HOUR OLD | | Hour reflection post, big visual milestone, stage → INFANT |

**Between steps** (from T+12), a background autonomous loop runs every 45–90s: observe → detect meaningful change → retrieve memories → choose IGNORE/REMEMBER/RESPOND/POST/ANALYZE/PROPOSE → Guardian → execute → log → store outcome. Cap: max 1 autonomous X post per 3 min, max 1 reply per 60s.

### 3b. DAYS 1–6 (wired: false — render only)
Stub entries for: Hour 6 (TODDLER), Day 1 (CHILD), Day 2 (expanded memory recall), Day 3 (larger autonomous limits), Day 4 (multi-step proposals), Day 5 (ADOLESCENT), Day 6 (MATURITY event). Each lists the capability it would unlock; site shows LOCKED + countdown. Flipping `wired: true` + implementing the task must be the only change needed later.

## 4. LLM ORCHESTRATOR

- `/server/services/orchestrator.ts`: `runTask(taskType, context)` → builds prompt from: stage system prompt + capability list + relevant memories + live data payload → calls Claude → validates JSON output with zod → emits events.
- **Stage system prompts** (`/server/prompts/stage_*.md`): writing ability grows by stage.
  - BIRTH: 1–3 words, lowercase, confused.
  - 2–10 min: short lowercase sentences, curious, asks questions.
  - 10–30 min: full short sentences, starting to use crypto terms it has *actually learned* (only terms in semantic memory).
  - 30–60 min: analytical, references specific numbers and remembered users, dry memecoin-native humor. Never corporate, never hashtags, never emojis spam, never price predictions or "buy now".
- All outputs are JSON: `{ say?: string, action?: Proposal, remember?: Memory[], reasoning_summary: string }`. `reasoning_summary` is a one-line public explanation shown in the terminal.
- Hard content filters before posting: no financial advice/promises, no price targets, no slurs, no doxxing, no replying to minors-flagged content, max 280 chars, **no URLs in X posts** (link posts cost $0.20 each on X pay-per-use; tx proof goes on the site, post says "proof on site").

## 5. SERVICES

- **solana.ts** — Helius: token supply, treasury SOL balance, holder list (DAS `getTokenAccounts` by mint), parsed recent txs. Poll 10s.
- **market.ts** — price, mcap, liquidity, volume from DexScreener (no key) + pump.fun bonding-curve trades via PumpPortal data websocket (`subscribeTokenTrade` for the mint). Computes derived metrics for ANALYZE_MARKET.
- **social.ts** — X API v2: mentions timeline (poll every 30s, `since_id`), post, reply. Track spend per call in DB; hard daily budget cap in config. Quote-posts and likes are NOT available on X pay-per-use — don't build them.
- **memory.ts** — write/read memories; retrieval = recent + same user + keyword/tag match (no vector DB needed for v1).
- **guardian.ts** — pure deterministic function `evaluate(proposal, state) → {approved, reason, maxAllowed?}`. No LLM. Unit-tested.
- **executor.ts** — only module that loads the private key. Builds swap:
  - Pre-migration (bonding curve): PumpPortal Local Transaction API (`/api/trade-local`) → sign locally → send via Helius.
  - Post-migration: Jupiter Swap API v2 (`api.jup.ag/swap/v2`) with API key.
  - Detect migration state automatically; confirm tx; store signature.
- **events.ts** — event bus → DB + Socket.IO broadcast.

## 6. GUARDIAN LIMITS (config, tune before launch)

```
MAX_BUYBACK_SOL_PER_TX = 0.5
MAX_SPEND_SOL_PER_HOUR = 2.0
MAX_SPEND_SOL_PER_DAY = 5.0
MIN_TREASURY_RESERVE_SOL = 3.0
MIN_SECONDS_BETWEEN_BUYBACKS = 240
MAX_SLIPPAGE_BPS = 500
ALLOWED_ACTIONS = ["BUYBACK"]           # no transfers, no sells, no approvals, no other mints
ALLOWED_PROGRAMS = [pump.fun, PumpSwap, Jupiter, System, Token, ATA, ComputeBudget]
```
Executor re-checks program IDs in the built tx before signing. Every rejection is shown publicly with reason and max allowed.

## 7. HUMAN OVERRIDES (/admin, ADMIN_TOKEN)

Kill switches: pause X posting, pause chat, freeze treasury, disable autonomous loop, force-skip a step, set LAUNCH_TIMESTAMP + TOKEN_MINT. Every use logs a `HUMAN` event publicly: `HUMAN SAFETY OVERRIDE ACTIVATED`.

## 8. DATABASE (Drizzle)

`capabilities, timeline_fired, events(id, ts, type, source, message, data jsonb, proof_url), actions(id, ts, type, status, tx_sig, x_url, proposal_id), proposals(id, ts, type, amount, reasons jsonb, confidence, guardian_result, guardian_reason), memories(id, ts, kind[episodic|social|semantic|project|decision|outcome], content, user_handle?, tags[], importance), people(handle, platform, first_seen_age_s, interactions, last_seen, relationship_summary), interactions(id, ts, handle, platform, inbound, outbound, x_post_id?), slang(term, definition, learned_at_age_s, source_handle), market_snapshots(ts, price, mcap, liq, vol_5m, vol_1h, holders, top10_pct, treasury_sol), x_spend(ts, endpoint, units, cost_usd)`

Store `first_seen_age_s` so later Baby can say "you asked me that when i was 11 minutes old."

## 9. FRONTEND

**Visual direction:** near-pure black, bright white UI, chrome/silver, subtle cold-blue glow, sterile biotech lab / AI containment interface. Monospace for data (JetBrains Mono / IBM Plex Mono), clean grotesk for headings. Avoid purple gradients, rainbow, Matrix green, cartoon anything, generic crypto dashboard look.

**Hero visual — particle baby:** `/public/baby.png` (user-supplied point-cloud crawling baby on black). Sample bright pixels into a point cloud (with slight z-depth noise) and render in three.js:
- `brainLevel` (0–1) from timeline drives visible particle count (~300 at birth → full density at T+60), brightness, and subtle breathing motion.
- Each unlock fires a visible "growth burst": new particles stream in from the edges and settle.
- A glowing neural cluster inside the head: regions light up per unlocked capability (SOCIAL, MARKET, MEMORY, LANGUAGE, DECISIONS).
- Scan line + faint containment-chamber frame + small HUD labels.
- Must hold 60fps on mid phones; fall back to static image with CSS glow on low-end.

**Page order:**
1. Hero: particle baby + AGE `00D 00H 12M 04S`, CURRENT STAGE, NEXT DEVELOPMENT + countdown, FULL MATURITY countdown, tagline
2. Development bars (LANGUAGE, MEMORY, SOCIAL CORTEX, MARKET UNDERSTANDING, DECISION MAKING, AUTONOMY, TREASURY CONTROL) — computed from real state (capabilities unlocked, memory count, words learned, actions taken), not random
3. Anatomy: EYES / EARS / MEMORY / BRAIN / VOICE / HANDS / GUARDIAN / NERVOUS SYSTEM — ACTIVE or LOCKED + unlock countdown
4. Live terminal: color-coded `[BIRTH] [SYSTEM] [LEARN] [MEMORY] [SOCIAL] [MARKET] [DECISION] [GUARDIAN] [ACTION] [DEVELOPMENT] [WARNING]`, each with source badge
5. Chat with Baby (stage-limited; rate-limit per IP; users can enter an X handle so Baby can recognize them)
6. Action log (separate from terminal) — every row links to Solscan tx or X post
7. Proposals + Guardian decisions
8. Development timeline (past steps ✓, upcoming, locked days)
9. Memories feed + PEOPLE I KNOW (handle, interactions, first interaction age, relationship summary)
10. Vital signs: AGE, MCAP, LIQUIDITY, HOLDERS, TREASURY, MENTIONS, MEMORIES, WORDS LEARNED
11. Token: CA (copy button), links to X / DexScreener / pump.fun

Top nav: BRAIN · CHAT · ACTIVITY · ACTIONS · MEMORIES · PEOPLE · TREASURY · TOKEN · X

Pre-launch state: site shows `GESTATING` with countdown to LAUNCH_TIMESTAMP.

## 10. SIM / DRY-RUN MODE (build this early)

- `MODE=sim`: mock adapters for X (fake mentions from a generator, posts logged not sent), market (synthetic trades/volume/holders with whale + dump events), executor (fake signatures). LLM is real.
- `SIM_SPEED` compresses the hour (10× = 6 min run). Admin button: "Run full first hour."
- Second test mode: `MODE=live` against a throwaway devnet or real tiny test token with X posting disabled, to validate real APIs + real swap path with 0.01 SOL.

## 11. BUILD ORDER

1. Repo scaffold, DB schema, env loading, event bus + Socket.IO, admin routes
2. Development engine + timeline config + capability gating
3. Frontend shell + terminal + hero counters (no 3D yet)
4. Sim adapters + orchestrator + stage prompts → full sim run of hour one visible on site
5. Memory, people, slang
6. Guardian (with unit tests) + executor (sim first)
7. Particle baby visual + neural regions + growth bursts
8. Real adapters: Helius, DexScreener, PumpPortal data, X
9. Real executor (PumpPortal local + Jupiter), devnet/tiny-token test
10. Polish, mobile, load test (site will get hammered at launch — cache public state, broadcast deltas)

## 12. ACCEPTANCE CHECKLIST

- [ ] Full sim hour runs end-to-end with no manual intervention
- [ ] Every step fires once; server restart mid-hour resumes correctly
- [ ] No Baby line is hardcoded except `hi`
- [ ] Every action row has a proof link
- [ ] Guardian rejects oversized/too-frequent/reserve-breaking proposals (tests)
- [ ] Executor refuses txs touching non-whitelisted programs
- [ ] All kill switches work and log HUMAN events
- [ ] X spend tracked, daily budget cap enforced
- [ ] Site works on mobile, particle baby ≥ 45fps on mid phone
- [ ] Locked day 1–6 capabilities render with correct countdowns
