import type { IncomingMessage, ServerResponse } from "node:http";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { nanoid } from "nanoid";
import { z } from "zod";
import { validateApiKey } from "../apps/api/src/lib/auth/api-key";
import { db } from "../apps/api/src/lib/db/client";
import {
  jobLogs,
  jobs,
  jobSteps,
  originEnum,
} from "../apps/api/src/lib/db/schema";
import { errorHandler } from "../apps/api/src/middleware/error-handler";
import apiKeysRoutes from "../apps/api/src/routes/api-keys";
import bootstrapRoutes from "../apps/api/src/routes/bootstrap";
import healthRoutes from "../apps/api/src/routes/health";
import projectsRoutes from "../apps/api/src/routes/projects";
import type { AppEnv } from "../apps/api/src/types";

const app = new Hono<AppEnv>();

app.use("*", cors());
app.onError(errorHandler);

app.route("/health", healthRoutes);
app.route("/bootstrap", bootstrapRoutes);

// Auth helper (inline instead of middleware to avoid Hono sub-router hang on Vercel)
async function requireAuth(
  c: Parameters<Parameters<typeof app.get>[1]>[0],
): Promise<{ projectId: string } | Response> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      { error: "Missing or invalid Authorization header. Use: Bearer mf_..." },
      401,
    );
  }
  const token = authHeader.slice("Bearer ".length);
  const result = await validateApiKey(token);
  if (!result) {
    return c.json({ error: "Invalid or expired API key" }, 401);
  }
  return result;
}

// ── Jobs routes (inline to avoid sub-router POST hang) ──────────────

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
    referenceRepos: z.array(referenceRepoSchema).optional().default([]),
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

app.post("/v1/jobs", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

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
    referenceRepos,
    createRepo,
    parentJobId,
    queueId,
    queuePosition,
    origin,
    queueItems,
    mode,
  } = parsed.data;

  if (parentJobId) {
    const existingParent = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, parentJobId), eq(jobs.projectId, auth.projectId)))
      .limit(1);
    if (existingParent.length === 0) {
      return c.json(
        { error: "Parent job not found or does not belong to project" },
        400,
      );
    }
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
        projectId: auth.projectId,
        parentJobId,
        queueId: generatedQueueId,
        queuePosition: position,
        origin: item.origin || "queue_child",
        task: item.task,
        repoOwner: item.repoOwner,
        repoName: item.repoName,
        baseBranch: item.baseBranch || "main",
        workBranch: parsed.data.workBranch ?? `machina/${id.slice(0, 8)}`,
        modelId: item.modelId || modelId,
        callbackUrl,
        referenceRepos: referenceRepos.length > 0 ? referenceRepos : undefined,
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

  const repoOwner = createRepo
    ? createRepo.org
    : (parsed.data.repoOwner as string);
  const repoName = createRepo
    ? createRepo.name
    : (parsed.data.repoName as string);

  const id = nanoid();
  const workBranch = parsed.data.workBranch ?? `machina/${id.slice(0, 8)}`;

  if (externalId) {
    const existing = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, auth.projectId),
          eq(jobs.externalId, externalId),
        ),
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
      projectId: auth.projectId,
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
      referenceRepos: referenceRepos.length > 0 ? referenceRepos : undefined,
      createRepoConfig: createRepo,
      modelId,
      callbackUrl,
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

app.get("/v1/jobs", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const cursor = c.req.query("cursor");

  const conditions = [eq(jobs.projectId, auth.projectId)];
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
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? lastItem.createdAt?.toISOString() : undefined;

  return c.json({ jobs: items, pagination: { limit, nextCursor, hasMore } });
});

app.get("/v1/jobs/:id", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  const job = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, auth.projectId)))
    .limit(1);

  if (job.length === 0) return c.json({ error: "Job not found" }, 404);

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

app.get("/v1/jobs/:id/chain", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  const projectId = auth.projectId;

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

  if (ancestorsList.length === 0)
    return c.json({ error: "Job not found" }, 404);

  const current = ancestorsList[0];
  const root = ancestorsList[ancestorsList.length - 1];
  const ancestors = ancestorsList.slice(1).reverse();

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

  return c.json({
    root,
    current,
    ancestors,
    descendants: descendants.slice(0, 200),
  });
});

app.post("/v1/jobs/:id/cancel", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  const job = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, auth.projectId)))
    .limit(1);

  if (job.length === 0) return c.json({ error: "Job not found" }, 404);

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

// Accept answers to clarifying questions from a completed plan-mode job
// and enqueue a sibling plan job with the Q&A appended to the task.
const answersSchema = z.object({
  answers: z
    .record(z.string().min(1), z.string().min(1))
    .refine((v) => Object.keys(v).length > 0, {
      message: "answers must not be empty",
    }),
});

app.post("/v1/jobs/:id/answers", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

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
    .where(and(eq(jobs.id, id), eq(jobs.projectId, auth.projectId)))
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

  const plan = original.result?.plan as
    | { status?: string; questions?: Array<{ id: string; question: string }> }
    | undefined;
  if (!plan || plan.status !== "clarify" || !plan.questions) {
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
  const newWorkBranch = `machina/${newId.slice(0, 8)}`;

  const [inserted] = await db
    .insert(jobs)
    .values({
      id: newId,
      projectId: auth.projectId,
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

app.get("/v1/queues/:queueId", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

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
    .where(and(eq(jobs.queueId, queueId), eq(jobs.projectId, auth.projectId)))
    .orderBy(asc(jobs.queuePosition), asc(jobs.createdAt));

  return c.json({
    queueId,
    jobs: queueJobs,
  });
});

app.post("/v1/queues/:queueId/advance", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const queueId = c.req.param("queueId");

  // Check if there's any active item before advancing
  const activeItems = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.queueId, queueId),
        eq(jobs.projectId, auth.projectId),
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
        eq(jobs.projectId, auth.projectId),
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

app.post("/v1/queues/:queueId/skip", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const queueId = c.req.param("queueId");

  const pausedItems = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.queueId, queueId),
        eq(jobs.projectId, auth.projectId),
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

app.post("/v1/queues/:queueId/cancel", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

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
        eq(jobs.projectId, auth.projectId),
        eq(jobs.status, "paused"),
      ),
    )
    .returning({ id: jobs.id });

  return c.json({
    count: result.length,
    cancelledIds: result.map((r) => r.id),
  });
});

app.get("/v1/jobs/:id/logs", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  const since = c.req.query("since");
  const level = c.req.query("level");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);

  const job = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.projectId, auth.projectId)))
    .limit(1);

  if (job.length === 0) return c.json({ error: "Job not found" }, 404);

  const conditions = [eq(jobLogs.jobId, id)];
  if (since) {
    conditions.push(sql`${jobLogs.createdAt} > ${since}`);
  }
  if (level) {
    conditions.push(eq(jobLogs.level, level));
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

  return c.json({ logs });
});

// ── Other v1 routes (via sub-router) ────────────────────────────────

app.use("/v1/projects/*", async (c, next) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  c.set("projectId", auth.projectId);
  return next();
});
app.route("/v1/projects", projectsRoutes);
app.route("/v1/projects", apiKeysRoutes);

app.get("/", (c) => c.json({ name: "machina-factory", version: "0.1.0" }));

// Custom Vercel adapter — @hono/node-server/vercel hangs on POST body reads
async function vercelHandler(req: IncomingMessage, res: ServerResponse) {
  // Buffer the raw body from IncomingMessage before creating the Web Request
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", resolve);
    req.on("error", reject);
  });
  const rawBody = Buffer.concat(chunks);

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = `${proto}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
  }

  const hasBody =
    req.method !== "GET" && req.method !== "HEAD" && rawBody.length > 0;
  const webReq = new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? rawBody : undefined,
  });

  const webRes = await app.fetch(webReq);

  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  if (webRes.body) {
    const reader = webRes.body.getReader();
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) res.write(result.value);
    }
  }
  res.end();
}

export default vercelHandler;
