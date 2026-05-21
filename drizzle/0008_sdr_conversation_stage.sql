DROP INDEX IF EXISTS "leads_sdr_whatsapp_unique_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_sdr_whatsapp_unique_idx";
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "conversation_stage" text DEFAULT 'permission' NOT NULL;
