CREATE TABLE "sdr_connection_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdr_connection_events" ADD CONSTRAINT "sdr_connection_events_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sdr_connection_events_agent_time_idx" ON "sdr_connection_events" USING btree ("sdr_agent_id","occurred_at");