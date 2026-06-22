-- Migrate storage from company-scoped to production-scoped
-- Files and folders are now owned by a production under storage/c/<company>/p/<production>/

ALTER TABLE "storage_folders" ADD COLUMN "production_id" uuid REFERENCES "productions"("id") ON DELETE CASCADE;
ALTER TABLE "storage_files" ADD COLUMN "production_id" uuid REFERENCES "productions"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Clear rows that cannot be migrated (no production_id mapping)
DELETE FROM "storage_files";
--> statement-breakpoint
DELETE FROM "storage_folders";
--> statement-breakpoint

ALTER TABLE "storage_folders" ALTER COLUMN "production_id" SET NOT NULL;
ALTER TABLE "storage_files" ALTER COLUMN "production_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "storage_folders" DROP COLUMN "company_id";
ALTER TABLE "storage_files" DROP COLUMN "company_id";
