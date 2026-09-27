CREATE TABLE "production_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_id" uuid NOT NULL,
	"role_id" uuid,
	"email" text,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp NOT NULL,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_invites" ADD CONSTRAINT "production_invites_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_invites" ADD CONSTRAINT "production_invites_role_id_production_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."production_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_invites" ADD CONSTRAINT "production_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_invites_hash_uq" ON "production_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "production_invites_production_idx" ON "production_invites" USING btree ("production_id");