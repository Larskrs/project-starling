-- Recreate track_mode enum with 'event' instead of 'free'
CREATE TYPE "track_mode_v2" AS ENUM ('event', 'clip');
--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "mode" TYPE text;
--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" TYPE text;
--> statement-breakpoint
DROP TYPE "track_mode";
--> statement-breakpoint
ALTER TYPE "track_mode_v2" RENAME TO "track_mode";
--> statement-breakpoint
UPDATE "tracks" SET "mode" = 'event' WHERE "mode" = 'free';
--> statement-breakpoint
UPDATE "track_types" SET "track_mode" = 'event' WHERE "track_mode" = 'free';
--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "mode" TYPE "track_mode" USING "mode"::"track_mode";
--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" TYPE "track_mode" USING "track_mode"::"track_mode";
--> statement-breakpoint
ALTER TABLE "track_types" ALTER COLUMN "track_mode" SET DEFAULT 'clip';
