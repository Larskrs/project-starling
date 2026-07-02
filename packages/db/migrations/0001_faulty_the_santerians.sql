CREATE TABLE "clip_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"file_id" uuid,
	"media_start" integer,
	"end" integer,
	"source_id" uuid,
	"data" jsonb,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clips_valid_media_range" CHECK ("media_start" IS NULL OR "end" IS NULL OR "end" > "media_start"),
	CONSTRAINT "clips_media_pair" CHECK (("media_start" IS NULL) = ("end" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "clip_notes" ADD CONSTRAINT "clip_notes_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_notes" ADD CONSTRAINT "clip_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_file_id_storage_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."storage_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_notes_clip_idx" ON "clip_notes" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "clips_track_position_idx" ON "clips" USING btree ("track_id","position");--> statement-breakpoint
CREATE INDEX "clips_source_idx" ON "clips" USING btree ("source_id");