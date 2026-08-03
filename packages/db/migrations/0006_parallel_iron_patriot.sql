CREATE TYPE "public"."activity_action" AS ENUM('open', 'create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."activity_entity" AS ENUM('timeline', 'production', 'company', 'file');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" "activity_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "activity_action" DEFAULT 'open' NOT NULL,
	"production_id" uuid,
	"company_id" uuid,
	"data" jsonb,
	"count" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_recent_idx" ON "activity" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_user_entity_idx" ON "activity" USING btree ("user_id","entity_type","entity_id","action");--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activity" USING btree ("entity_type","entity_id");