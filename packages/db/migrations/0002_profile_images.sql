ALTER TABLE "storage_files" ALTER COLUMN "production_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_files" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "storage_files" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "profile_image_id" uuid;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "banner_image_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_image_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banner_image_id" uuid;
--> statement-breakpoint
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
