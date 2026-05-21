CREATE TABLE "lead_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"success_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"mapping" text,
	"errors" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"whatsapp_number" text NOT NULL,
	"cnpj" text,
	"company_name" text NOT NULL,
	"trade_name" text,
	"segment" text,
	"city" text,
	"state" text,
	"contact_name" text,
	"extra_data" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"first_message_sent_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"followup_due_at" timestamp with time zone,
	"followup_sent_at" timestamp with time zone,
	"followup_disabled_at" timestamp with time zone,
	"human_paused_until" timestamp with time zone,
	"ai_paused_at" timestamp with time zone,
	"ai_pause_reason" text,
	"handoff_requested_at" timestamp with time zone,
	"handoff_summary" text,
	"not_interested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_sdr_whatsapp_unique_idx" ON "leads" USING btree ("sdr_agent_id","whatsapp_number");