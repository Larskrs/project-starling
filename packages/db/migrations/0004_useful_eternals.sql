ALTER TABLE "clips" ADD COLUMN "hue" integer;--> statement-breakpoint
ALTER TABLE "track_types" ADD COLUMN "hue" integer DEFAULT 250 NOT NULL;