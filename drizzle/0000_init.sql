CREATE TABLE "actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"amount_sol" double precision,
	"tokens_out" double precision,
	"tx_sig" text,
	"x_url" text,
	"x_post_id" text,
	"proof_url" text,
	"proposal_id" integer,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"name" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"unlocked_at" timestamp with time zone,
	"unlocked_at_age_s" integer
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"ip_hash" text NOT NULL,
	"handle" text,
	"inbound" text NOT NULL,
	"outbound" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"proof_url" text
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"handle" text NOT NULL,
	"platform" text NOT NULL,
	"inbound" text,
	"outbound" text,
	"x_post_id" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"price" double precision,
	"mcap" double precision,
	"liq" double precision,
	"vol_5m" double precision,
	"vol_1h" double precision,
	"holders" integer,
	"top10_pct" double precision,
	"treasury_sol" double precision,
	"migrated" boolean
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"user_handle" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"importance" double precision DEFAULT 0.5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"handle" text NOT NULL,
	"text" text NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"minor_flag" boolean DEFAULT false NOT NULL,
	"rank" double precision,
	"rank_data" jsonb,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "people" (
	"handle" text NOT NULL,
	"platform" text NOT NULL,
	"first_seen_age_s" integer NOT NULL,
	"interactions" integer DEFAULT 0 NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"relationship_summary" text,
	CONSTRAINT "people_handle_platform_pk" PRIMARY KEY("handle","platform")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"type" text NOT NULL,
	"amount" double precision NOT NULL,
	"slippage_bps" integer DEFAULT 300 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"guardian_result" text,
	"guardian_reason" text,
	"max_allowed" double precision,
	"parent_id" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slang" (
	"term" text PRIMARY KEY NOT NULL,
	"definition" text NOT NULL,
	"learned_at_age_s" integer NOT NULL,
	"source_handle" text,
	"used_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_fired" (
	"step_id" text PRIMARY KEY NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"sig" text PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"age_s" integer,
	"wallet" text NOT NULL,
	"side" text NOT NULL,
	"sol" double precision NOT NULL,
	"tokens" double precision NOT NULL,
	"is_treasury" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"cost_usd" double precision NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_ts_idx" ON "events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "interactions_handle_idx" ON "interactions" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "snapshots_age_idx" ON "market_snapshots" USING btree ("age_s");--> statement-breakpoint
CREATE INDEX "memories_user_idx" ON "memories" USING btree ("user_handle");--> statement-breakpoint
CREATE INDEX "trades_age_idx" ON "trades" USING btree ("age_s");