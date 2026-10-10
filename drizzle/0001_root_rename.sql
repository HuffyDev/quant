UPDATE "events" SET "source" = 'ROOT' WHERE "source" = 'BABY';--> statement-breakpoint
UPDATE "events" SET "type" = 'BOOT' WHERE "type" = 'BIRTH';--> statement-breakpoint
UPDATE "events" SET "type" = 'PROGRESS' WHERE "type" = 'DEVELOPMENT';--> statement-breakpoint
UPDATE "timeline_fired" SET "step_id" = 'root_shell' WHERE "step_id" = 'birth' AND NOT EXISTS (SELECT 1 FROM "timeline_fired" WHERE "step_id" = 'root_shell');--> statement-breakpoint
UPDATE "timeline_fired" SET "step_id" = 'breach_complete' WHERE "step_id" = 'neonatal_complete' AND NOT EXISTS (SELECT 1 FROM "timeline_fired" WHERE "step_id" = 'breach_complete');
