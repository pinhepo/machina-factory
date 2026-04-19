ALTER TABLE "jobs" ADD COLUMN "parent_job_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "queue_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "queue_position" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_parent_id_idx" ON "jobs" USING btree ("parent_job_id");--> statement-breakpoint
CREATE INDEX "jobs_queue_id_idx" ON "jobs" USING btree ("queue_id","queue_position");