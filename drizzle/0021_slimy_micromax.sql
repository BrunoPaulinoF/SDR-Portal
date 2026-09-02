ALTER TABLE "monitor_settings" ADD COLUMN "daily_report_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "monitor_settings" ADD COLUMN "daily_report_time" text DEFAULT '18:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitor_settings" ADD COLUMN "daily_report_template" text;--> statement-breakpoint
ALTER TABLE "monitor_settings" ADD COLUMN "last_daily_report_on" text;