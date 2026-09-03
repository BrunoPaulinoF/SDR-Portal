ALTER TABLE "monitor_settings" ADD COLUMN "leads_alert_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "monitor_settings" ADD COLUMN "leads_alert_threshold" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitor_settings" ADD COLUMN "leads_alert_template" text;--> statement-breakpoint
ALTER TABLE "sdr_connection_states" ADD COLUMN "pending_leads" integer;--> statement-breakpoint
ALTER TABLE "sdr_connection_states" ADD COLUMN "leads_alert_at" timestamp with time zone;