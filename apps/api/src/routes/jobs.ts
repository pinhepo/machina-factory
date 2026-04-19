import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../lib/db/client";
import { buildWorkBranch } from "../lib/jobs/branch-name";
import { jobSteps, jobs, originEnum } from "../lib/db/schema";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

const deployConfigSchema = z
  .object({
    machinaApiKey: z.string().optional(),
    clientApiUrl: z.string().url().optional(),
    coreApiUrl: z.string().url().optional(),
    autoPushTemplates: z.boolean().optional(),
    autoRedeploy: z.boolean().optional(),
  })
  .optional();

const studioNamedSchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
});

const studioProjectContextSchema = z
  .object({
    projectId: z.string().min(1),
    orgId: z.string().min(1),
    name: z.string().min(1),
    clientApiUrl: z.string().url().optional(),
    studioBaseUrl: z.string().url().optional(),
    connectors: z.array(studioNamedSchema).optional(),
    agents: z.array(studioNamedSchema).optional(),
    templates: z.array(studioNamedSchema).optional(),
    workflows: z.array(studioNamedSchema).optional(),
  })
  .optional();

const referenceRepoSchema = z.object({
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  branch: z.string().optional(),
});

const createRepoSchema = z.object({
  org: z.string().min(1).default("machina-sports"),
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Repo name may only contain letters, digits, '.', '_' and '-'",
    ),
  fromRepo: referenceRepoSchema,
  private: z.boolean().default(true),
  description: z.string().optional(),
});

const queueItemSchema = z.object({
  task: z.string().min(1, "Task description is required"),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  baseBranch: z.string().default("main"),
  modelId: z.string().optional(),
  origin: z.enum(originEnum).default("queue_child"),
});

const createJobSchema = z
  .object({
    task: z.string().min(1, "Task description is required").optional(),
    repoOwner: z.string().min(1).optional(),
    repoName: z.string().min(1).optional(),
    baseBranch: z.string().default("main").optional(),
    workBranch: z.string().optional(),
    modelId: z.string().optional(),
    externalId: z.string().optional(),
    callbackUrl: z.string().url().optional(),
    deployConfig: deployConfigSchema,
    projectContext: studioProjectContextSchema,
    referenceRepos: z.array(referenceRepoSchema).optional(),
    createRepo: createRepoSchema.optional(),
    parentJobId: z.string().optional(),
    queueId: z.string().optional(),
    queuePosition: z.number().int().min(1).optional(),
    origin: z.enum(originEnum).default("user"),
    queueItems: z.array(queueItemSchema).min(1).optional(),
    mode: z.enum(["execute", "plan"]).default("execute").optional(),
  })
  .refine(
    (d) => {
      if (d.mode === "plan" && d.queueId) return false;
      return true;
    },
    { message: "Plan jobs cannot be queue children" },
  )
  .refine(
    (d) => {
      if (d.mode === "plan" && d.queueItems) return false;
      return true;
    },
    { message: "Plan jobs cannot contain queueItems" },
  )
  .refine(
    (d) => {
      if (d.queueItems) return true;
      return Boolean(d.createRepo) || Boolean(d.repoOwner && d.repoName);
    },
    {
      message:
        "Either repoOwner+repoName, createRepo, or queueItems must be provided",
    },
  )
  .refine(
    (d) => {
      if (d.queueItems) {
        return !d.task && !d.repoOwner && !d.repoName && !d.createRepo;
      }
      return !!d.task;
    },
    {
      message:
        "Cannot mix queueItems with single-job fields (task, repoOwner, repoName, createRepo)",
    },
  );

app.post("/", async (c) => {
  const projectId = c.get("projectId");
  const body = await c.req.json();
  const parsed = createJobSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      400,
    );
  }

  const {
    task,
    baseBranch,
    modelId,
    externalId,
    callbackUrl,
    deployConfig,
    projectContext,
    referenceRepos,
    createRepo,
    parentJobId,
    queueId,
    queuePosition,
    origin,
    queueItems,
    mode,
  } = parsed.data;

  // Fetch parent job once so we can both validate and propagate its
  // projectContext / deployConfig to any children we create below.
  let parentJob:
    | {
        id: string;
        projectContext: typeof jobs.$inferSelect.projectContext;
        deployConfig: typeof jobs.$inferSelect.deployConfig;
      }
    | undefined;
  if (parentJobId) {
    const existingParent = await db
      .select({
        id: jobs.id,
        projectContext: jobs.projectContext,
        deployConfig: jobs.deployConfig,
      })
      .from(jobs)
      .where(and(eq(jobs.id, parentJobId), eq(jobs.projectId, projectId)))
      .limit(1);
    if (existingParent.length === 0) {
      return c.json(
        { error: "Parent job not found or does not belong to project" },
        400,
      );
    }
    parentJob = existingParent[0];
  }

  // Handle multiple jobs (queueItems)
  if (queueItems && queueItems.length >= 1) {
    const generatedQueueId = nanoid();
    const createdJobs = [];

    const insertValues = queueItems.map((item, index) => {
      const id = nanoid();
      const position = index + 1;
      const status = position === 1 ? "queued" : "paused";

      return {
        id,
        projectId,
        parentJobId,
        queueId: generatedQueueId,
        queuePosition: position,
        origin: item.origin || "queue_child",
        task: item.task,
        repoOwner: item.repoOwner,
        repoName: item.repoName,
        baseBranch: item.baseBranch || "main",
        workBranch: parsed.data.workBranch ?? buildWorkBranch(item.task, id),
        modelId: item.modelId || modelId,
        callbackUrl,
        deployConfig: deployConfig ?? parentJob?.deployConfig ?? undefined,
        projectContext:
          projectContext ?? parentJob?.projectContext ?? undefined,
        referenceRepos,
        status: status as (typeof jobs.status.enumValues)[number],
      };
    });

    const inserted = await db.insert(jobs).values(insertValues).returning({
      id: jobs.id,
      status: jobs.status,
      queuePosition: jobs.queuePosition,
      task: jobs.task,
    });

    return c.json(
      {
        queueId: generatedQueueId,
        jobs: inserted,
      },
      201,
    );
  }

  // Handle single job
  const repoOwner = createRepo
    ? createRepo.org
    : (parsed.data.repoOwner as string);
  const repoName = createRepo
    ? createRepo.name
    : (parsed.data.repoName as string);

  // Auto-generate work branch if not provided
  const id = nanoid();
  const workBranch = parsed.data.workBranch ?? buildWorkBranch(task ?? "", id);

  // Check for duplicate externalId
  if (externalId) {
    const existing = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(
        and(eq(jobs.projectId, projectId), eq(jobs.externalId, externalId)),
      )
      .limit(1);

    const existingJob = existing[0];
    if (existingJob) {
      return c.json(
        {
          error: "Job with this externalId already exists",
          jobId: existingJob.id,
          status: existingJob.status,
        },
        409,
      );
    }
  }

  const [inserted] = await db
    .insert(jobs)
    .values({
      id,
      projectId,
      externalId,
      parentJobId,
      queueId,
      queuePosition,
      origin,
      task: task as string,
      repoOwner,
      repoName,
      baseBranch: baseBranch || "main",
      workBranch,
      modelId,
      callbackUrl,
      deployConfig,
      projectContext,
      referenceRepos,
      createRepoConfig: createRepo,
      mode: mode || "execute",
      status: "queued",
    })
    .returning({ id: jobs.id, createdAt: jobs.createdAt });

  return c.json(
    {
      id: inserted?.id ?? id,
      status: "queued",
      workBranch,
      createdAt: inserted?.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    201,
  );
});

app.get("/", async (c) => {
  const projectId = c.get("projectId");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const cursor = c.req.query("cursor");

  const conditions = [eq(jobs.projectId, projectId)];
  if (status) {
    conditions.push(
      eq(jobs.status, status as (typeof jobs.status.enumValues)[number]),
    );
  }
  if (cursor) {
    conditions.push(sql`${jobs.createdAt} < ${cursor}`);
  }

  const results = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      task: jobs.task,
      repoOwner: jobs.repoOwner,
      repoName: jobs.repoName,
      baseBranch: jobs.baseBranch,
      workBranch: jobs.workBranch,
      mode: jobs.mode,
      result: jobs.result,
      error: jobs.error,
      startedAt: jobs.startedAt,
      completedAt: jobs.completedAt,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt))
    .limit(limit + 1); // Fetch one extra for cursor

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? lastItem.createdAt?.toISOString() : undefined;

  return c.json({
    jobs: items,
    pagination: { limit, nextCursor, hasMore },
  });
});

app.get("/:id", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");

  const job = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, projectId)))
    .limit(1);

  if (job.length === 0) {
    return c.json({ error: "Job not found" }, 404);
  }

  const steps = await db
    .select({
      id: jobSteps.id,
      step: jobSteps.step,
      status: jobSteps.status,
      output: jobSteps.output,
      startedAt: jobSteps.startedAt,
      completedAt: jobSteps.completedAt,
      durationMs: jobSteps.durationMs,
    })
    .from(jobSteps)
    .where(eq(jobSteps.jobId, id));

  return c.json({ ...job[0], steps });
});

app.get("/:id/chain", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");

  const jobSelect = {
    id: jobs.id,
    parentJobId: jobs.parentJobId,
    queueId: jobs.queueId,
    queuePosition: jobs.queuePosition,
    origin: jobs.origin,
    task: jobs.task,
    status: jobs.status,
    repoOwner: jobs.repoOwner,
    repoName: jobs.repoName,
    createdAt: jobs.createdAt,
    completedAt: jobs.completedAt,
  };

  // 1. Iterative ancestor fetch (up to 20 depth)
  const ancestorsList = [];
  let currentId: string | null = id;
  let depth = 0;
  while (currentId && depth < 20) {
    const row = await db
      .select(jobSelect)
      .from(jobs)
      .where(and(eq(jobs.id, currentId), eq(jobs.projectId, projectId)))
      .limit(1);

    if (!row[0]) break;
    ancestorsList.push(row[0]);
    currentId = row[0].parentJobId;
    depth++;
  }

  if (ancestorsList.length === 0) {
    return c.json({ error: "Job not found" }, 404);
  }

  const current = ancestorsList[0];
  const root = ancestorsList[ancestorsList.length - 1];
  // ancestors should be from root down to parent (excluding current)
  // Currently ancestorsList is [current, parent, grandparent, ..., root]
  // We want [root, ..., grandparent, parent]
  const ancestors = ancestorsList.slice(1).toReversed();

  // 2. Iterative descendants fetch (BFS, up to 20 depth, max 200 nodes)
  const descendants = [];
  let currentParentIds = [id];
  let dDepth = 0;

  while (
    currentParentIds.length > 0 &&
    dDepth < 20 &&
    descendants.length < 200
  ) {
    const rows = await db
      .select(jobSelect)
      .from(jobs)
      .where(
        and(
          inArray(jobs.parentJobId, currentParentIds),
          eq(jobs.projectId, projectId),
        ),
      );

    if (!rows.length) break;

    descendants.push(...rows);
    currentParentIds = rows.map((r) => r.id);
    dDepth++;
  }

  // Cap descendants at 200 just in case
  const cappedDescendants = descendants.slice(0, 200);

  return c.json({
    root,
    current,
    ancestors,
    descendants: cappedDescendants,
  });
});

const answersSchema = z.object({
  answers: z
    .record(z.string().min(1), z.string().min(1))
    .refine((v) => Object.keys(v).length > 0, {
      message: "answers must not be empty",
    }),
});

app.post("/:id/answers", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => ({}));
  const parsed = answersSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      400,
    );
  }

  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, projectId)))
    .limit(1);
  const original = rows[0];
  if (!original) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (original.status !== "completed") {
    return c.json(
      {
        error: `Job is ${original.status}; only completed plan jobs accept answers`,
      },
      400,
    );
  }

  const plan = original.result?.plan;
  if (!plan || !("status" in plan) || plan.status !== "clarify") {
    return c.json(
      { error: "Original job does not have clarifying questions" },
      400,
    );
  }

  const qaBlock = plan.questions
    .map((q) => {
      const a = parsed.data.answers[q.id];
      if (!a) return null;
      return `- Q: ${q.question}\n  A: ${a}`;
    })
    .filter((v): v is string => v !== null);

  if (qaBlock.length === 0) {
    return c.json(
      { error: "No answers matched the original clarifying questions" },
      400,
    );
  }

  const newTask = `${original.task}\n\n---\nClarifying answers:\n${qaBlock.join("\n")}`;

  const newId = nanoid();
  const newWorkBranch = buildWorkBranch(original.task, newId);

  const [inserted] = await db
    .insert(jobs)
    .values({
      id: newId,
      projectId,
      parentJobId: id,
      origin: "continuation",
      task: newTask,
      repoOwner: original.repoOwner,
      repoName: original.repoName,
      baseBranch: original.baseBranch,
      workBranch: newWorkBranch,
      modelId: original.modelId,
      callbackUrl: original.callbackUrl,
      deployConfig: original.deployConfig,
      projectContext: original.projectContext,
      referenceRepos: original.referenceRepos,
      mode: "plan",
      status: "queued",
    })
    .returning({ id: jobs.id, createdAt: jobs.createdAt });

  return c.json(
    {
      id: inserted?.id ?? newId,
      status: "queued",
      workBranch: newWorkBranch,
      createdAt: inserted?.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    201,
  );
});

app.post("/:id/cancel", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");

  const job = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, projectId)))
    .limit(1);

  if (job.length === 0) {
    return c.json({ error: "Job not found" }, 404);
  }

  const currentStatus = job[0]?.status;
  if (
    currentStatus === "completed" ||
    currentStatus === "failed" ||
    currentStatus === "cancelled"
  ) {
    return c.json(
      { error: `Job is already ${currentStatus}`, id, status: currentStatus },
      400,
    );
  }

  await db
    .update(jobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id))
    .returning({ id: jobs.id });

  return c.json({ id, status: "cancelled" });
});

export default app;
