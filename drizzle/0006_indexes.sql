-- Existing duplicate titles get part of their id appended (unlike a counter, it cannot clash with
-- another title), so the unique index can be created without losing ideas.
UPDATE "activity" AS a SET "title" = a."title" || ' (' || left(a."id"::text, 8) || ')'
FROM (
  SELECT "id", row_number() OVER (PARTITION BY lower("title") ORDER BY "created_at", "id") AS n
  FROM "activity"
) AS d
WHERE a."id" = d."id" AND d.n > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_title_unique_idx" ON "activity" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "chat_message_created_at_idx" ON "chat_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "date_plan_status_starts_idx" ON "date_plan" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "plan_item_plan_position_idx" ON "plan_item" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "suggestion_log_plan_idx" ON "suggestion_log" USING btree ("plan_id");