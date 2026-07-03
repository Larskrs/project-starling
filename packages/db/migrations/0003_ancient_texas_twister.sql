CREATE TYPE "public"."clip_display" AS ENUM('normal', 'zebra', 'border', 'transparent');--> statement-breakpoint
CREATE TYPE "public"."name_display" AS ENUM('normal', 'stretch', 'emphasize');--> statement-breakpoint
CREATE TYPE "public"."track_display" AS ENUM('normal', 'ruler');--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" SET DEFAULT 'clip'::text;--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "mode" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."track_mode";--> statement-breakpoint
CREATE TYPE "public"."track_mode" AS ENUM('event', 'clip');--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" SET DEFAULT 'clip'::"public"."track_mode";--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" SET DATA TYPE "public"."track_mode" USING "track_mode"::"public"."track_mode";--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "mode" SET DATA TYPE "public"."track_mode" USING "mode"::"public"."track_mode";--> statement-breakpoint
ALTER TABLE "track_types" ADD COLUMN "track_display" "track_display" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "track_types" ADD COLUMN "name_display" "name_display" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "track_types" ADD COLUMN "clip_display" "clip_display" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "track_types" ADD COLUMN "metronome" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "track_types" ADD COLUMN "tts" boolean DEFAULT false NOT NULL;