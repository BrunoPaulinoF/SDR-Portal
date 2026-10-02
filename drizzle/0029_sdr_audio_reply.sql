ALTER TABLE "sdr_agents" ADD COLUMN "audio_reply_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "elevenlabs_api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "elevenlabs_voice_id" text;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "elevenlabs_model" text DEFAULT 'eleven_multilingual_v2' NOT NULL;