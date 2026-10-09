ALTER TABLE "date_plan" ADD COLUMN "over_budget_eur" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "area_name" text;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "travel_home" jsonb;--> statement-breakpoint
ALTER TABLE "date_plan" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "slot" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "preparation" text;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "at_home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "opening_hours_unknown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "place" jsonb;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL;