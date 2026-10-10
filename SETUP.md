# Baby Brain — Setup

A newborn AI born at token launch, developing in public. **You raise it. It runs the coin.**
Full product spec: [`BABY_BRAIN_SPEC.md`](./BABY_BRAIN_SPEC.md).

This repo is a complete, sim-tested build. It runs end-to-end with **no API keys** in simulation mode, then switches to real APIs by setting env vars and `MODE=live`.

---

## 1. Import into Replit

1. **Create Repl → Import from GitHub** → this repo (branch `claude/replit-migration-apis-tblgmi` or `main` once merged).
2. **Add a database:** Tools → **Database** → create **PostgreSQL**. Replit sets `DATABASE_URL` for you. Tables are created automatically on boot from the migrations in `/drizzle`. If the tables already exist without drizzle's migration journal (Replit publish pre-creates them in production), boot *baselines* instead: it records the journal, creates only what's missing (tables, indexes, columns) and logs exactly what it did. Existing data is never touched.
3. **Add secrets:** Tools → **Secrets**. At minimum for the first sim run:
   - `ADMIN_TOKEN`: any long random string, e.g. the output of `openssl rand -hex 32`
   - `ANTHROPIC_API_KEY`: needed for Baby to actually think. Without it, sim mode falls back to the `[MOCK-LLM]` placeholder brain.
4. Press **Run**. This runs `npm run build && npm start`, which builds the frontend and starts the single server process on port 5000 (mapped to port 80). There is no database setup step: the app creates and migrates its tables on boot.
5. Open the webview. The site shows **GESTATING**.
6. Open `/admin`, paste your `ADMIN_TOKEN`, and click **RUN FULL FIRST HOUR**. At the default `SIM_SPEED=10` the first hour of development plays out in 6 real minutes (a new step every ~12s). The clocks and every time label on the site show real elapsed time; only development is accelerated.

**Deploying:** Deploy → **Reserved VM** (already configured in `.replit`). Do **not** use Autoscale: the development engine, pollers, websockets and autonomous loop must run continuously, and Autoscale scales to zero.

---

## 2. Environment variables

Every variable is listed in [`.env.example`](./.env.example) with a placeholder. On Replit, set them in **Secrets**. Never commit real values.

| Variable | Sim | Live | Where to get it |
|---|---|---|---|
| `MODE` | `sim` | `live` | `sim` uses mock X / market / chain / executor with a seeded simulated token. `live` uses the real APIs. |
| `SIM_SPEED` | optional | ignored | Development speed in sim (default 10 = first hour in 6 real min; 1 = real pace). Clocks and time labels always show real elapsed time. Ignored in live. |
| `DATABASE_URL` | **required** | **required** | Replit → Tools → Database → PostgreSQL (set automatically). Neon also works. |
| `ADMIN_TOKEN` | **required** for /admin | **required** | Generate it yourself: `openssl rand -hex 32`. Protects `/admin` and `/admin/api/*`. |
| `ANTHROPIC_API_KEY` | recommended | **required** | [console.anthropic.com](https://console.anthropic.com) → API Keys. Baby uses `claude-sonnet-5-5` (posts, replies, observations, proposals) and `claude-haiku-5-5` (mention ranking, slang extraction). |
| `LLM_PROVIDER` | optional | — | `mock` forces the keyless placeholder brain (sim only, refused in live). Default `anthropic`. |
| `X_API_KEY`, `X_API_SECRET` | — | **required** | [developer.x.com](https://developer.x.com) → Developer Portal → your Project → App → **Keys and tokens** → API Key and Secret. Set **User authentication settings → App permissions = Read and write** first. |
| `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | — | **required** | Same page → **Access Token and Secret**. Generate it while logged in as the **Baby account**, *after* setting Read and write, or posting will 403. |
| `X_BEARER_TOKEN` | — | recommended | Same page → **Bearer Token**. Used for reading mentions. |
| `X_BOT_HANDLE`, `X_BOT_USER_ID` | — | optional | The Baby account's handle (no @) and numeric id. **At startup the server calls `GET /2/users/me` with the OAuth 1.0a credentials and uses the id/handle it returns.** If they differ from these vars, a public WARNING is logged. The env values are only a fallback if that call fails. |
| `X_DAILY_BUDGET_USD` | optional | recommended | Hard daily X spend cap (default `$5`). Calls past it are refused and logged publicly. |
| `X_COST_POST_USD`, `X_COST_READ_USD` | optional | optional | Per-call costs used for the daily budget. Defaults: **$0.015 per post/reply** and **$0.005 per post read**. |
| `X_WRITES_DISABLED` | — | test only | `true` reads X but never posts (live test mode). |
| `HELIUS_API_KEY` / `HELIUS_RPC_URL` | — | **required** | [dashboard.helius.dev](https://dashboard.helius.dev) → API Keys. The RPC URL is `https://mainnet.helius-rpc.com/?api-key=…`. Only one of the two is needed. |
| `JUPITER_API_KEY` | — | needed after migration | Jupiter Developer Platform ([developers.jup.ag](https://developers.jup.ag)) → API keys. Used for buybacks once the token leaves the pump.fun bonding curve (Swap API v2). |
| `PUMPPORTAL_API_KEY` | — | optional | [pumpportal.fun](https://pumpportal.fun). Not needed for the local trade API. May be needed for PumpSwap (post-migration) trade data on the websocket. |
| `BIRDEYE_API_KEY` | — | optional | Not used in v1. |
| `TOKEN_MINT` | auto | **required at launch** | The pump.fun mint address. Can also be set from `/admin`. |
| `TOKEN_NAME`, `TOKEN_SYMBOL` | optional | optional | Display fallbacks. On-chain metadata is preferred in live. |
| `LAUNCH_TIMESTAMP` | optional | **required at launch** | ISO UTC time of T+0, e.g. `2026-10-10T18:00:00Z`. Can also be set from `/admin` ("LAUNCH NOW"). |
| `TREASURY_PUBKEY` | — | **required** | Public key of a **fresh, dedicated** treasury wallet. |
| `TREASURY_PRIVATE_KEY` | — | **required** | That wallet's base58 secret key, e.g. Phantom → Export Private Key, or `solana-keygen new` then base58-encode. **Only** `server/services/adapters/live/executor.ts` reads it, and it is checked against `TREASURY_PUBKEY`. |
| `MAX_BUYBACK_SOL_PER_TX` … `MAX_SLIPPAGE_BPS` | optional | tune | Guardian limits. Defaults are in [`server/config/limits.ts`](./server/config/limits.ts) (0.5 per tx, 2/hour, 5/day, 3 SOL reserve, 240s cooldown, 500 bps). |
| `FIRST_BUYBACK_SOL` | optional | optional | Fixed amount for the T+4 first buyback (default 0.2). |
| `MIN_SECONDS_BETWEEN_REPLIES` | optional | optional | Reply pace (default 60). Baby replies on X from birth, at most one reply per this many seconds; the reply loop runs on the same interval. Each reply costs `X_COST_POST_USD`, so at the default about 60 replies/hour ≈ $0.90/hour + mention reads. Size `X_DAILY_BUDGET_USD` accordingly. |
| `THOUGHT_POSTS_ENABLED`, `THOUGHT_POST_MIN_S`, `THOUGHT_POST_MAX_S` | optional | optional | "Thought" tweets: from birth Baby posts a short, model-written tweet about growing up every random 30–120s (defaults). Set `THOUGHT_POSTS_ENABLED=false` to turn off. At the defaults that's ~45 posts/hour ≈ $0.70/hour at $0.015/post, on top of replies — size `X_DAILY_BUDGET_USD` accordingly (posting stops for the day when the cap is hit). |
| `TRUST_PROXY_HOPS` | optional | optional | Reverse proxies in front of the app (Replit = 1). Used to get the real client IP for chat rate limits. |

Fund the treasury with at least `MIN_TREASURY_RESERVE_SOL` plus the amount you're willing to spend (for example 3 + 5 SOL with the defaults).

---

## 3. Sim mode (dry run)

```bash
MODE=sim                 # default
SIM_SPEED=10             # development speed (default): first hour in 6 real min; 1 = real pace
ANTHROPIC_API_KEY=…      # real LLM (recommended); omit to use the [MOCK-LLM] placeholder
```

- X: mentions come from a seeded generator (fans, a recurring supporter, scammers, a minor-flagged user). Posts are logged, not sent, and get a `/sim/x/<id>` proof page.
- Market and chain: a deterministic simulated pump.fun bonding curve with scripted beats. An early wallet dumps at ~T+7m, a whale buys 12 SOL at ~T+33m, and there's a later dump.
- Executor: buybacks move the simulated curve and get a fake signature with a `/sim/tx/<sig>` proof page.
- Everything else is real: the engine, Guardian, memory, people, slang, content filter, X budget, kill switches.
- `/admin` → **RUN FULL FIRST HOUR** resets all run state and launches now. **RESET TO GESTATING** clears it.
- The sim is restart-safe. Kill the process mid-hour and it resumes; steps never re-fire.

Locally (outside Replit): Postgres + `cp .env.example .env` + `npm ci` + `npm run build && npm start`.

---

## 4. Live test mode (before launch)

**First, run the read-only API check** (Replit Shell, with your Secrets set):

```bash
npm run check:live
```

It tests each real API without posting, signing or touching the database, and prints `PASS` / `WARN` / `FAIL` / `SKIP` per line. It exits non-zero if anything fails.

| Check | What it does |
|---|---|
| Anthropic | retrieves both models, plus one ~16-token test message |
| Helius RPC | `getHealth` + `getSlot` |
| Helius holders | DAS `getAsset` + `getTokenAccounts` for `TOKEN_MINT` (falls back to USDC and WARNs if unset) |
| pump.fun bonding curve | reads and decodes the curve account (price, `complete` flag) |
| DexScreener | pairs for `TOKEN_MINT` (WARN if not indexed yet — normal for a brand-new token) |
| PumpPortal websocket | connects, subscribes to the mint, waits for the first message |
| X `/2/users/me` | OAuth 1.0a identity; WARN if it differs from `X_BOT_USER_ID` / `X_BOT_HANDLE` |
| X mentions | reads ≤5 mentions (costs ≤5 × `X_COST_READ_USD`) |
| Jupiter | `GET /swap/v2/order` **without a taker**: a quote only, no transaction is built |
| Treasury | SOL balance (WARN if at or below the reserve) and that `TREASURY_PRIVATE_KEY` decodes to `TREASURY_PUBKEY` (no signing) |

Then:

Validate the real APIs and the real swap path with a **tiny throwaway token** on mainnet. pump.fun has no usable devnet.

1. Create a test token on pump.fun from a throwaway wallet. Use a **separate** throwaway treasury wallet funded with about 0.2 SOL.
2. Secrets:
   ```
   MODE=live
   X_WRITES_DISABLED=true          # read mentions, never post
   FIRST_BUYBACK_SOL=0.01
   MAX_BUYBACK_SOL_PER_TX=0.01
   MIN_TREASURY_RESERVE_SOL=0.05
   TOKEN_MINT=<test mint>
   TREASURY_PUBKEY=… / TREASURY_PRIVATE_KEY=…
   HELIUS_API_KEY=…  ANTHROPIC_API_KEY=…  X_* keys
   ```
3. Run, open `/admin`, and click **LAUNCH NOW**. Watch the terminal:
   - T+2 READ_TOKEN shows the real supply, mcap and treasury
   - T+4 executes a real **0.01 SOL** buyback. The action row links to Solscan, and the server log shows `[executor] preflight ok · programs …`
   - T+6 / T+8 show real holders and trades (from the PumpPortal websocket)
   - T+10+ reads real mentions; posts are logged as "X writes disabled — NOT sent"
4. To test posting, remove `X_WRITES_DISABLED` on a test X account.
5. If the token migrates during testing, the next buyback goes through Jupiter. Check the log line listing the programs it touched (see §7).

---

## 5. Launch day

1. Fund the real treasury. Set the `MODE=live` secrets. Remove `X_WRITES_DISABLED`. Tune Guardian limits.
2. **Before** launch: set `TOKEN_MINT` (or set it from `/admin`) and `LAUNCH_TIMESTAMP` to the planned T+0. The site shows GESTATING with a countdown.
3. Deploy as a **Reserved VM**.
4. At T+0 the engine fires BIRTH: Baby posts `hi` (the only hardcoded line). Everything after that is generated from live data.
5. Keep `/admin` open. Kill switches: **pause X posting**, **pause chat**, **freeze treasury**, **disable autonomous loop**, **force-skip a step**, **set LAUNCH_TIMESTAMP / TOKEN_MINT**. Every use is logged publicly as `HUMAN SAFETY OVERRIDE ACTIVATED`.

---

## 6. Architecture (one process)

```
server/
  index.ts                 boot: migrations → settings → adapters → engine, pollers, autonomy loop, web + Socket.IO
  env.ts                   zod-validated env (treasury key deliberately NOT parsed here)
  config/timeline.ts       the schedule: 31 wired first-hour steps + Hour 6 … Day 6 locked stubs
  config/limits.ts         Guardian limits, autonomy caps, program whitelist
  prompts/*.md             base rules + stage voices (birth / early / cortex / analytical)
  services/
    engine.ts              fires each step exactly once (DB-claimed); restart-safe
    capabilities.ts        flags in DB; requireCap() throws when locked
    orchestrator.ts        runTask(): stage prompt + capabilities + memories + live data → Claude → zod → events
    llm.ts / mockLLM.ts    Anthropic SDK structured outputs / keyless placeholder (sim only)
    tasks/index.ts         one handler per timeline task
    autonomy.ts            from T+12: observe → detect change → decide → Guardian → act (caps enforced)
    replyLoop.ts           from birth: replies to the best unanswered mention every MIN_SECONDS_BETWEEN_REPLIES
    thoughtLoop.ts         from birth: short "growing up" tweets at random 30–120s intervals
    guardian.ts            pure deterministic evaluate(proposal, state) — unit tested
    proposals.ts flows.ts  propose → review → (re-propose once) → execute
    executor.ts            Guardian re-check + kill switch → adapter.buyback → action row with proof
    social.ts              X post/reply/mentions, content filter, budget, caps, minor block
    market.ts solana.ts    pollers (system) + gated views for Baby
    memory.ts              memories, people (first_seen_age_s), interactions, slang
    events.ts state.ts     event bus → DB + Socket.IO; cached public state, delta broadcasts
    adapters/sim/*         seeded simulated world
    adapters/live/*        Helius, DexScreener + pump.fun curve, PumpPortal ws, X v2, live executor
client/                    React + Vite + Tailwind; three.js particle baby (lazy-loaded, FPS fallback)
public/                    baby.png, stages.png, stages/*.png
```

**Wiring Day 1–6 later:** implement the task handler in `server/services/tasks/index.ts`, set the step's `task`, and flip `wired: true` in `server/config/timeline.ts`. Nothing else changes. The site already renders them as LOCKED with countdowns.

---

## 7. Verify on Replit (could not be tested from the build environment)

The build environment's network policy blocked Helius, X, PumpPortal, DexScreener and Jupiter, so the **live adapters are written against the documented APIs and unit-tested on their pure parts, but not yet exercised against the real services.** Check these during the live test (§4):

- [ ] **Helius DAS** `getTokenAccounts` / `getAsset` response shape (holder counts look right on the site).
- [ ] **pump.fun bonding-curve decode**: price and mcap on the site match pump.fun.
- [ ] **PumpPortal websocket** trades arrive (log: `[pumpportal] subscribed …`). If post-migration data needs a key, set `PUMPPORTAL_API_KEY`.
- [ ] **PumpPortal `trade-local`** buy works with `denominatedInSol: "true"`, `slippage` in percent, `pool: "pump"`.
- [ ] **Jupiter Swap API v2** (`GET /swap/v2/order` → sign → `POST /swap/v2/execute`, header `x-api-key`). If a route touches a program not in `ALLOWED_PROGRAMS`, the executor refuses and falls back to PumpSwap via PumpPortal (`pool: "pump-amm"`). To allow more programs, add their IDs to `server/config/limits.ts` **after verifying them**.
- [ ] **X**: mentions timeline, post and reply with your app's access level (`npm run check:live` covers users/me and mentions; posting is only tested by the live run).

Safety checks that run before every live signature (all unit-tested): only whitelisted top-level programs; the treasury must be a required signer; a simulation must show the treasury debited at most the approved amount + 0.03 SOL; and the Guardian is re-evaluated immediately before signing.

---

## 8. Commands

```bash
npm run build && npm start   # what the Run button does: build frontend, start server (migrates DB on boot)
npm start           # production start (expects a prior `npm run build`)
npm run build       # build frontend to dist/
npm run dev         # server only, watch mode
npm run dev:client  # Vite dev server on :5173 (proxies /api, /admin/api, /socket.io to :5000)
npm test            # unit tests (Guardian, executor checks, content filter, gating, timeline, sim)
TEST_ADMIN_DATABASE_URL=postgres://user:pass@host/postgres npm test   # + migration integration tests (needs CREATE DATABASE)
npm run check:live  # read-only PASS/FAIL check of every real API (see §4)
npm run typecheck
npx drizzle-kit generate   # developers only, after editing server/db/schema.ts: writes a new migration that is applied automatically on next boot
```

---

## 9. Acceptance checklist (spec §12): status in sim

- [x] Full sim hour runs end-to-end with no manual intervention (31/31 steps, 0 crashes)
- [x] Every step fires once; restart mid-hour resumes correctly (killed at T+20, resumed, 31 distinct, no duplicates; trades continuous across downtime)
- [x] No Baby line is hardcoded except `hi` (all other Baby text comes from the LLM; the mock is tagged `[MOCK-LLM]` and refused in live)
- [x] Every action row has a proof link (Solscan / X in live; `/sim/*` in sim; failed buybacks link to their public failure record)
- [x] Guardian rejects oversized / too-frequent / reserve-breaking proposals (unit tests + seen live in sim)
- [x] Executor refuses txs touching non-whitelisted programs (unit tests)
- [x] All kill switches work and log HUMAN events
- [x] X spend tracked, daily budget cap enforced (budget-bounded fetch sizes limit overshoot)
- [x] Site works on mobile (no horizontal overflow at 390px); particle baby lazy-loads with automatic static fallback below 30fps / low-end / reduced-motion. **Measure real fps on a mid phone.**
- [x] Locked Day 1–6 capabilities render with correct countdowns
- [ ] Live adapters exercised against real APIs (§7)

Load test (1 process, sim running): 1,000 concurrent Socket.IO clients, 0 failures; `/api/state` ~2,900 req/s at p95 32 ms, 0 errors.
