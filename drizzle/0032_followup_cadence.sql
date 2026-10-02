ALTER TABLE "leads" ADD COLUMN "followup_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "followup_max_touches" integer DEFAULT 1 NOT NULL;