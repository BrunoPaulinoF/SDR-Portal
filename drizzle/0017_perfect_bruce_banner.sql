ALTER TABLE "leads" ADD COLUMN "followup_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "bump_prompt" text;