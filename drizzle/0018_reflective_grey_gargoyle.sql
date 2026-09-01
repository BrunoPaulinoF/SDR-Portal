CREATE TABLE "monitor_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" text DEFAULT 'default' NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"uazapi_base_url" text,
	"uazapi_instance_id" text,
	"uazapi_instance_token_encrypted" text,
	"alert_recipients" text,
	"alert_template" text,
	"recovery_template" text,
	"notify_on_recovery" boolean DEFAULT true NOT NULL,
	"repeat_alert_minutes" integer DEFAULT 60 NOT NULL,
	"only_active_agents" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_settings_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "sdr_connection_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"instance_status" text,
	"disconnect_reason" text,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"last_alert_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdr_connection_states" ADD CONSTRAINT "sdr_connection_states_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sdr_connection_states_agent_unique_idx" ON "sdr_connection_states" USING btree ("sdr_agent_id");