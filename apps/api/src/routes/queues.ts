import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../lib/db/client";
import { jobs } from "../lib/db/schema";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/:queueId", async (c) => {
  const projectId = c.get("projectId");
  const queueId = c.req.param("queueId");

  const queueJobs = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      task: jobs.task,
      origin: jobs.origin,
      queuePosition: jobs.queuePosition,
      createdAt: jobs.createdAt,
      completedAt: jobs.completedAt,
      repoOwner: jobs.repoOwner,
      repoName: jobs.repoName,
    })
    .from(jobs)
    .where(and(eq(jobs.queueId, queueId), eq(jobs.projectId, projectId)))
    .orderBy(asc(jobs.queuePosition), asc(jobs.createdAt));

  return c.json({
    queueId,
    jobs: queueJobs,
  });
});

app.post("/:queueId/advance", async (c) => {
  const projectId = c.get("projectId");
  const queueId = c.req.param("queueId");

  // Check if there's any active item before advancing
  const activeItems = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.queueId, queueId),
        eq(jobs.projectId, projectId),
        inArray(jobs.status, [
          "queued",
          "provisioning",
          "running",
          "verifying",
          "committing",
          "deploying",
        ]),
      ),
    )
    .limit(1);

  if (activeItems.length > 0) {
    return c.json({ error: "Cannot advance while a job is still active" }, 409);
  }

  const pausedItems = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.queueId, queueId),
        eq(jobs.projectId, projectId),
        eq(jobs.status, "paused"),
      ),
    )
    .orderBy(asc(jobs.queuePosition))
    .limit(1);

  if (pausedItems.length === 0) {
    return c.json({ error: "No paused items found in this queue" }, 404);
  }

  const nextJob = pausedItems[0];
  if (!nextJob)
    return c.json({ error: "No paused items found in this queue" }, 404);

  await db
    .update(jobs)
    .set({
      status: "queued",
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, nextJob.id));

  return c.json({
    ...nextJob,
    status: "queued",
    updatedAt: new Date().toISOString(),
  });
});

app.post("/:queueId/skip", async (c) => {
  const projectId = c.get("projectId");
  const queueId = c.req.param("queueId");

  const pausedItems = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.queueId, queueId),
        eq(jobs.projectId, projectId),
        eq(jobs.status, "paused"),
      ),
    )
    .orderBy(asc(jobs.queuePosition))
    .limit(1);

  if (pausedItems.length === 0) {
    return c.json({ error: "No paused items found in this queue" }, 404);
  }

  const nextJob = pausedItems[0];
  if (!nextJob)
    return c.json({ error: "No paused items found in this queue" }, 404);

  await db
    .update(jobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, nextJob.id));

  return c.json({
    ...nextJob,
    status: "cancelled",
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

app.post("/:queueId/cancel", async (c) => {
  const projectId = c.get("projectId");
  const queueId = c.req.param("queueId");

  const result = await db
    .update(jobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.queueId, queueId),
        eq(jobs.projectId, projectId),
        eq(jobs.status, "paused"),
      ),
    )
    .returning({ id: jobs.id });

  return c.json({
    count: result.length,
    cancelledIds: result.map((r) => r.id),
  });
});

export default app;
