ALTER TABLE "sdr_agents" ALTER COLUMN "ai_provider" SET DEFAULT 'deepseek';--> statement-breakpoint
ALTER TABLE "sdr_agents" ALTER COLUMN "ai_model" SET DEFAULT 'deepseek-v4-pro';--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "prompt_cache_hit_tokens" integer;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "deepseek_api_key_encrypted" text;--> statement-breakpoint
-- Data migration: move every existing SDR agent to the DeepSeek API (requested explicitly).
-- Requires DEEPSEEK_API_KEY in the environment, or a per-SDR key set afterwards in /sdr-agents,
-- otherwise these agents stop responding until a DeepSeek key is configured.
UPDATE "sdr_agents" SET "ai_provider" = 'deepseek', "ai_model" = 'deepseek-v4-pro';