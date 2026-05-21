CREATE TABLE "lead_research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"query" text,
	"summary" text,
	"sources" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_research" ADD CONSTRAINT "lead_research_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_research" ADD CONSTRAINT "lead_research_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_research_lead_unique_idx" ON "lead_research" USING btree ("lead_id");