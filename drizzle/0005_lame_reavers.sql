CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"whatsapp_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"whatsapp_message_id" text,
	"message_type" text NOT NULL,
	"text" text,
	"transcription" text,
	"media_url" text,
	"raw_payload" text,
	"sent_by_api" boolean DEFAULT false NOT NULL,
	"from_me" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sdr_agent_id" uuid,
	"event_type" text,
	"message_type" text,
	"instance_id" text,
	"whatsapp_message_id" text,
	"from_number" text,
	"to_number" text,
	"from_me" boolean,
	"was_sent_by_api" boolean,
	"raw_headers" text,
	"raw_body" text NOT NULL,
	"normalized_body" text,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_sdr_whatsapp_unique_idx" ON "conversations" USING btree ("sdr_agent_id","whatsapp_number");