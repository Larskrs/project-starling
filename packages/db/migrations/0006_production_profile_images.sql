ALTER TABLE "storage_files" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "profile_image_id" uuid;
--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "banner_image_id" uuid;
