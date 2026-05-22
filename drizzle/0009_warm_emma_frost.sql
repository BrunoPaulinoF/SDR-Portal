ALTER TABLE "sdr_agents" ADD COLUMN "lead_qualification_prompt" text;--> statement-breakpoint
ALTER TABLE "sdr_agents" ALTER COLUMN "ai_model" SET DEFAULT 'gpt-5.4-mini';
