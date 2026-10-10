import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

const ts = () => timestamp("ts", { withTimezone: true }).notNull().defaultNow();

/** Key/value runtime settings (launch timestamp, mint, kill switches, sim seed). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const capabilities = pgTable("capabilities", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  unlockedAtAgeS: integer("unlocked_at_age_s"),
});

export const timelineFired = pgTable("timeline_fired", {
  stepId: text("step_id").primaryKey(),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  ageS: integer("age_s").notNull(),
  skipped: boolean("skipped").notNull().default(false),
  status: text("status").notNull().default("running"), // running | done | failed | skipped
  error: text("error"),
});

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    ts: ts(),
    ageS: integer("age_s"),
    type: text("type").notNull(),
    source: text("source").notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
    proofUrl: text("proof_url"),
  },
  (t) => [index("events_ts_idx").on(t.ts)],
);

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  ts: ts(),
  ageS: integer("age_s"),
  type: text("type").notNull(),
  amount: doublePrecision("amount").notNull(),
  slippageBps: integer("slippage_bps").notNull().default(300),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  confidence: doublePrecision("confidence").notNull().default(0),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED | EXECUTED | FAILED
  guardianResult: text("guardian_result"),
  guardianReason: text("guardian_reason"),
  maxAllowed: doublePrecision("max_allowed"),
  parentId: integer("parent_id"),
});

export const actions = pgTable("actions", {
  id: serial("id").primaryKey(),
  ts: ts(),
  ageS: integer("age_s"),
  type: text("type").notNull(), // BUYBACK | X_POST | X_REPLY
  status: text("status").notNull(), // PENDING | CONFIRMED | FAILED
  amountSol: doublePrecision("amount_sol"),
  tokensOut: doublePrecision("tokens_out"),
  txSig: text("tx_sig"),
  xUrl: text("x_url"),
  xPostId: text("x_post_id"),
  proofUrl: text("proof_url"),
  proposalId: integer("proposal_id"),
  summary: text("summary"),
});

export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    ts: ts(),
    ageS: integer("age_s"),
    kind: text("kind").notNull(), // episodic | social | semantic | project | decision | outcome
    content: text("content").notNull(),
    userHandle: text("user_handle"),
    tags: text("tags").array().notNull().default([]),
    importance: doublePrecision("importance").notNull().default(0.5),
  },
  (t) => [index("memories_user_idx").on(t.userHandle)],
);

export const people = pgTable(
  "people",
  {
    handle: text("handle").notNull(),
    platform: text("platform").notNull(), // x | web
    firstSeenAgeS: integer("first_seen_age_s").notNull(),
    interactions: integer("interactions").notNull().default(0),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    relationshipSummary: text("relationship_summary"),
  },
  (t) => [primaryKey({ columns: [t.handle, t.platform] })],
);

export const interactions = pgTable(
  "interactions",
  {
    id: serial("id").primaryKey(),
    ts: ts(),
    ageS: integer("age_s"),
    handle: text("handle").notNull(),
    platform: text("platform").notNull(),
    inbound: text("inbound"),
    outbound: text("outbound"),
    xPostId: text("x_post_id"),
    meta: jsonb("meta"),
  },
  (t) => [index("interactions_handle_idx").on(t.handle)],
);

/** Raw X mentions as fetched (system log; reading them is gated by READ_X). */
export const mentions = pgTable("mentions", {
  id: text("id").primaryKey(),
  ts: ts(),
  ageS: integer("age_s"),
  handle: text("handle").notNull(),
  text: text("text").notNull(),
  followers: integer("followers").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  minorFlag: boolean("minor_flag").notNull().default(false),
  rank: doublePrecision("rank"),
  rankData: jsonb("rank_data"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
});

export const slang = pgTable("slang", {
  term: text("term").primaryKey(),
  definition: text("definition").notNull(),
  learnedAtAgeS: integer("learned_at_age_s").notNull(),
  sourceHandle: text("source_handle"),
  usedCount: integer("used_count").notNull().default(0),
});

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: serial("id").primaryKey(),
    ts: ts(),
    ageS: integer("age_s"),
    price: doublePrecision("price"),
    mcap: doublePrecision("mcap"),
    liq: doublePrecision("liq"),
    vol5m: doublePrecision("vol_5m"),
    vol1h: doublePrecision("vol_1h"),
    holders: integer("holders"),
    top10Pct: doublePrecision("top10_pct"),
    treasurySol: doublePrecision("treasury_sol"),
    migrated: boolean("migrated"),
  },
  (t) => [index("snapshots_age_idx").on(t.ageS)],
);

/** Recent trades seen (from PumpPortal / Helius / sim). */
export const trades = pgTable(
  "trades",
  {
    sig: text("sig").primaryKey(),
    ts: ts(),
    ageS: integer("age_s"),
    wallet: text("wallet").notNull(),
    side: text("side").notNull(), // buy | sell
    sol: doublePrecision("sol").notNull(),
    tokens: doublePrecision("tokens").notNull(),
    isTreasury: boolean("is_treasury").notNull().default(false),
  },
  (t) => [index("trades_age_idx").on(t.ageS)],
);

export const xSpend = pgTable("x_spend", {
  id: serial("id").primaryKey(),
  ts: ts(),
  endpoint: text("endpoint").notNull(),
  units: integer("units").notNull().default(1),
  costUsd: doublePrecision("cost_usd").notNull(),
  simulated: boolean("simulated").notNull().default(false),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  ts: ts(),
  ageS: integer("age_s"),
  ipHash: text("ip_hash").notNull(),
  handle: text("handle"),
  inbound: text("inbound").notNull(),
  outbound: text("outbound"),
});
