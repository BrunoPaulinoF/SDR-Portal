CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"cnpj" text,
	"segment" text,
	"description" text,
	"website_url" text,
	"default_handoff_name" text,
	"default_handoff_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_cnpj_unique_idx" ON "companies" USING btree ("cnpj");