CREATE TYPE "public"."activity_source" AS ENUM('manual', 'claude', 'import');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('draft', 'active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('reserved', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."paid_provider" AS ENUM('anthropic', 'google_places');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('suggested', 'accepted', 'done', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('deutschlandticket', 'car', 'walk', 'bike');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"cost_min_eur" integer DEFAULT 0 NOT NULL,
	"cost_max_eur" integer DEFAULT 0 NOT NULL,
	"duration_minutes" integer NOT NULL,
	"weather" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transports" "transport_mode"[] DEFAULT '{}' NOT NULL,
	"at_home" boolean DEFAULT false NOT NULL,
	"place_type" text,
	"place_query" text,
	"times_of_day" text[] DEFAULT '{}' NOT NULL,
	"seasons" text[] DEFAULT '{}' NOT NULL,
	"preparation" text,
	"status" "activity_status" DEFAULT 'draft' NOT NULL,
	"source" "activity_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "paid_provider" NOT NULL,
	"status" "call_status" DEFAULT 'reserved' NOT NULL,
	"estimated_cost_usd" double precision NOT NULL,
	"actual_cost_usd" double precision,
	"day" text NOT NULL,
	"month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "date_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"parameters" jsonb NOT NULL,
	"weather" jsonb,
	"total_cost_eur" integer DEFAULT 0 NOT NULL,
	"status" "plan_status" DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}' NOT NULL,
	"device_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"activity_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"place_provider" text,
	"place_id" text,
	"place_name" text,
	"cost_eur" integer DEFAULT 0 NOT NULL,
	"travel" jsonb
);
--> statement-breakpoint
CREATE TABLE "session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"home_name" text NOT NULL,
	"home_postal_code" text NOT NULL,
	"home_lat" double precision NOT NULL,
	"home_lng" double precision NOT NULL,
	"default_transport" "transport_mode" DEFAULT 'deutschlandticket' NOT NULL,
	"default_budget_eur" integer DEFAULT 50 NOT NULL,
	"max_radius_km" integer DEFAULT 80 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"plan_id" uuid,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_weight" (
	"tag" text NOT NULL,
	"context" text DEFAULT 'any' NOT NULL,
	"weight" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "tag_weight_tag_context_pk" PRIMARY KEY("tag","context")
);
--> statement-breakpoint
CREATE TABLE "travel_routine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transport" "transport_mode" NOT NULL,
	"description" text NOT NULL,
	"first_leg_mode" "transport_mode",
	"first_leg_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"origin_station" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_item" ADD CONSTRAINT "plan_item_plan_id_date_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."date_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item" ADD CONSTRAINT "plan_item_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_log" ADD CONSTRAINT "suggestion_log_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_log" ADD CONSTRAINT "suggestion_log_plan_id_date_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."date_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_status_idx" ON "activity" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_usage_provider_day_idx" ON "api_usage" USING btree ("provider","day");--> statement-breakpoint
CREATE INDEX "api_usage_provider_month_idx" ON "api_usage" USING btree ("provider","month");--> statement-breakpoint
CREATE INDEX "api_usage_created_at_idx" ON "api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_attempt_ip_idx" ON "login_attempt" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "suggestion_log_activity_idx" ON "suggestion_log" USING btree ("activity_id","created_at");