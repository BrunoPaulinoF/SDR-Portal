ALTER TABLE "leads" ADD COLUMN "meeting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "won_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;