CREATE TABLE "instance_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sdr_agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "sdr_agents" ADD COLUMN "ai_reasoning_effort" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_share_links" ADD CONSTRAINT "instance_share_links_sdr_agent_id_sdr_agents_id_fk" FOREIGN KEY ("sdr_agent_id") REFERENCES "public"."sdr_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_share_links" ADD CONSTRAINT "instance_share_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;