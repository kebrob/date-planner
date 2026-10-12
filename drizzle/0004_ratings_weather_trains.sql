CREATE TYPE "public"."date_rating" AS ENUM('dislike', 'like', 'love');--> statement-breakpoint
DROP TABLE "tag_weight" CASCADE;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "weather_point" jsonb;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "rating" date_rating;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "not_happened" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "rating_prompt_dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "trains_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "rating" date_rating;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "place_blamed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "weather_conditions" text[];