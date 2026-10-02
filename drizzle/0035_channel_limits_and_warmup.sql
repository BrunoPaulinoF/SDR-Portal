CREATE TABLE "sdr_channel_limits" (
	"sdr_agent_id" uuid PRIMARY KEY NOT NULL,
	"can_start_conversations" boolean,
	"blocked_until" timestamp with time zone,
	"block_reason" text,
	"quota_used" integer,
	"quota_total" integer,
	"quota_resets_at" timestamp with time zone,
	"source" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "warmup_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sdr_channel_limits" ADD CONSTRAINT "sdr_channel_limits_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;