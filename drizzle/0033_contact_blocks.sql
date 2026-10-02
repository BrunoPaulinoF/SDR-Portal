CREATE TABLE "contact_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whatsapp_number" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_blocks_number_unique_idx" ON "contact_blocks" USING btree ("whatsapp_number");