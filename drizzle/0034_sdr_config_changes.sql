CREATE TABLE "sdr_config_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"field" text NOT NULL,
	"before" text,
	"after" text,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdr_config_changes" ADD CONSTRAINT "sdr_config_changes_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sdr_config_changes_agent_time_idx" ON "sdr_config_changes" USING btree ("sdr_agent_id","created_at");