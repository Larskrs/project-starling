CREATE TYPE "public"."storage_file_type" AS ENUM('image', 'audio');
--> statement-breakpoint
CREATE TABLE "storage_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"type" "storage_file_type" NOT NULL,
	"physical_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_image_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"quality_removed" integer NOT NULL,
	"physical_path" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_folders" ADD CONSTRAINT "storage_folders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_folders" ADD CONSTRAINT "storage_folders_parent_id_storage_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."storage_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_folder_id_storage_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."storage_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_image_versions" ADD CONSTRAINT "storage_image_versions_file_id_storage_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."storage_files"("id") ON DELETE cascade ON UPDATE no action;
