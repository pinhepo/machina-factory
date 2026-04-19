import { and, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../lib/db/client";
import { jobLogs, jobs } from "../lib/db/schema";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/:id/logs", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");
  const since = c.req.query("since");
  const level = c.req.query("level");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);

  // Verify job belongs to project
  const job = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, projectId)))
    .limit(1);

  if (job.length === 0) {
    return c.json({ error: "Job not found" }, 404);
  }

  const conditions = [eq(jobLogs.jobId, id)];
  if (since) {
    conditions.push(gt(jobLogs.createdAt, new Date(since)));
  }
  if (level) {
    conditions.push(
      eq(jobLogs.level, level as (typeof jobLogs.level.enumValues)[number]),
    );
  }

  const logs = await db
    .select({
      id: jobLogs.id,
      level: jobLogs.level,
      message: jobLogs.message,
      metadata: jobLogs.metadata,
      createdAt: jobLogs.createdAt,
    })
    .from(jobLogs)
    .where(and(...conditions))
    .orderBy(desc(jobLogs.createdAt))
    .limit(limit);

  return c.json({ logs: logs.toReversed() }); // Return in chronological order
});

export default app;
