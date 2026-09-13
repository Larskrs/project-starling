CREATE TYPE "public"."api_token_event" AS ENUM('issued', 'revoked', 'rejected', 'create', 'update', 'delete');--> statement-breakpoint
CREATE TABLE "api_token_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid,
	"production_id" uuid,
	"event" "api_token_event" NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"actor_user_id" uuid,
	"ip" text,
	"detail" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_id" uuid NOT NULL,
	"role_id" uuid,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_token_events" ADD CONSTRAINT "api_token_events_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token_events" ADD CONSTRAINT "api_token_events_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token_events" ADD CONSTRAINT "api_token_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_role_id_production_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."production_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_events_token_idx" ON "api_token_events" USING btree ("token_id","occurred_at");--> statement-breakpoint
CREATE INDEX "api_token_events_production_idx" ON "api_token_events" USING btree ("production_id","occurred_at");--> statement-breakpoint
CREATE INDEX "api_tokens_production_idx" ON "api_tokens" USING btree ("production_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");