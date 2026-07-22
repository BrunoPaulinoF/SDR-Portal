CREATE TABLE "first_message_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"label" text NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"assigned_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_message_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "first_message_mode" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "first_message_variants" ADD CONSTRAINT "first_message_variants_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_first_message_variant_id_first_message_variants_id_fk" FOREIGN KEY ("first_message_variant_id") REFERENCES "public"."first_message_variants"("id") ON DELETE set null ON UPDATE no action;