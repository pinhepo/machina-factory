import { neon } from "@neondatabase/serverless";
import postgres from "postgres";

type QueryFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

let _sql: QueryFn | null = null;

export function getSQL(): QueryFn {
  if (_sql) return _sql;

  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL environment variable is required");
  }

  // Neon serverless driver only works with Neon URLs (uses HTTP).
  // For local PostgreSQL, fall back to postgres.js (uses TCP).
  const isNeon = url.includes("neon.tech");

  if (isNeon) {
    const sql = neon(url);
    _sql = sql as unknown as QueryFn;
  } else {
    const client = postgres(url);
    _sql = client as unknown as QueryFn;
  }

  return _sql;
}

export type Project = {
  id: string;
  machinaOrgId: string;
  machinaProjectId: string;
  githubOwner: string | null;
  githubRepo: string | null;
  defaultBranch: string;
  settings: ProjectSettings | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSettings = {
  modelId?: string;
  customInstructions?: string;
  deploy?: DeployConfig;
};

export type DeployConfig = {
  machinaApiKey?: string;
  clientApiUrl?: string;
  coreApiUrl?: string;
  autoPushTemplates?: boolean;
  autoRedeploy?: boolean;
};

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    machinaOrgId: row.machina_org_id as string,
    machinaProjectId: row.machina_project_id as string,
    githubOwner: row.github_owner as string | null,
    githubRepo: row.github_repo as string | null,
    defaultBranch: (row.default_branch as string) ?? "main",
    settings: row.settings as ProjectSettings | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getProject(): Promise<Project | null> {
  const sql = getSQL();
  const projectId = process.env.FACTORY_PROJECT_ID;

  let rows: Record<string, unknown>[];
  if (projectId) {
    rows = await sql`
      SELECT * FROM projects WHERE id = ${projectId} LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT * FROM projects ORDER BY created_at ASC LIMIT 1
    `;
  }

  if (rows.length === 0) return null;
  return mapProject(rows[0]);
}

export async function updateProjectSettings(
  projectId: string,
  settings: ProjectSettings,
): Promise<void> {
  const sql = getSQL();

  // Merge with existing settings (settings may come as string from some drivers)
  const existing = await sql`
    SELECT settings FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  const raw = existing[0]?.settings;
  const currentSettings: ProjectSettings =
    typeof raw === "string"
      ? JSON.parse(raw)
      : ((raw as ProjectSettings) ?? {});
  const merged = { ...currentSettings, ...settings };

  await sql`
    UPDATE projects
    SET settings = ${JSON.stringify(merged)}::jsonb,
        updated_at = NOW()
    WHERE id = ${projectId}
  `;
}

export type Job = {
  id: string;
  projectId: string | null;
  status: string;
  task: string;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  workBranch: string;
  referenceRepos: Array<{
    repoOwner: string;
    repoName: string;
    branch?: string;
  }> | null;
  projectContext: {
    projectId: string;
    orgId: string;
    name: string;
    clientApiUrl?: string;
    studioBaseUrl?: string;
  } | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    steps?: number;
    modelId?: string;
  } | null;
  modelId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  parentJobId: string | null;
  queueId: string | null;
  queuePosition: number | null;
  origin: string;
};

export type JobStep = {
  id: string;
  jobId: string;
  step: string;
  status: string;
  output: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type JobLog = {
  id: string;
  jobId: string;
  level: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export function mapJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    projectId: row.project_id as string | null,
    status: row.status as string,
    task: row.task as string,
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    baseBranch: row.base_branch as string,
    workBranch: row.work_branch as string,
    referenceRepos: row.reference_repos as Job["referenceRepos"],
    projectContext: row.project_context as Job["projectContext"],
    usage: row.usage as Job["usage"],
    modelId: row.model_id as string | null,
    result: row.result as Record<string, unknown> | null,
    error: row.error as string | null,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    createdAt: row.created_at as string,
    parentJobId: row.parent_job_id as string | null,
    queueId: row.queue_id as string | null,
    queuePosition: row.queue_position as number | null,
    origin: row.origin as string,
  };
}

function mapJobStep(row: Record<string, unknown>): JobStep {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    step: row.step as string,
    status: row.status as string,
    output: row.output as Record<string, unknown> | null,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    durationMs: row.duration_ms as number | null,
  };
}

function mapJobLog(row: Record<string, unknown>): JobLog {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    level: row.level as string,
    message: row.message as string,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.created_at as string,
  };
}

export async function getJobs(): Promise<Job[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      id, project_id, status, task, repo_owner, repo_name,
      base_branch, work_branch, reference_repos, project_context, usage, model_id, result, error,
      started_at, completed_at, created_at, parent_job_id, queue_id, queue_position, origin
    FROM jobs
    ORDER BY created_at DESC
  `;
  return rows.map(mapJob);
}

export async function getJob(id: string): Promise<Job | null> {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      id, project_id, status, task, repo_owner, repo_name,
      base_branch, work_branch, reference_repos, project_context, usage, model_id, result, error,
      started_at, completed_at, created_at, parent_job_id, queue_id, queue_position, origin
    FROM jobs
    WHERE id = ${id}
  `;
  if (rows.length === 0) return null;
  return mapJob(rows[0]);
}

export async function getJobSteps(jobId: string): Promise<JobStep[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      id, job_id, step, status, output,
      started_at, completed_at, duration_ms
    FROM job_steps
    WHERE job_id = ${jobId}
    ORDER BY started_at ASC NULLS LAST
  `;
  return rows.map(mapJobStep);
}

export async function getJobLogs(jobId: string): Promise<JobLog[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      id, job_id, level, message, metadata, created_at
    FROM job_logs
    WHERE job_id = ${jobId}
    ORDER BY created_at ASC
  `;
  return rows.map(mapJobLog);
}

export async function getJobChildren(jobId: string): Promise<Job[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      id, project_id, status, task, repo_owner, repo_name,
      base_branch, work_branch, reference_repos, project_context, usage, model_id, result, error,
      started_at, completed_at, created_at, parent_job_id, queue_id, queue_position, origin
    FROM jobs
    WHERE parent_job_id = ${jobId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapJob);
}

export type CancelJobResult =
  | { ok: true; status: "cancelled" }
  | { ok: false; reason: "not-found" | "already-terminal"; status?: string };

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export async function cancelJob(id: string): Promise<CancelJobResult> {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, status FROM jobs WHERE id = ${id} LIMIT 1
  `;
  if (rows.length === 0) return { ok: false, reason: "not-found" };

  const currentStatus = rows[0]?.status as string;
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return { ok: false, reason: "already-terminal", status: currentStatus };
  }

  await sql`
    UPDATE jobs
    SET status = 'cancelled',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id}
  `;
  return { ok: true, status: "cancelled" };
}

export async function getJobLogsSince(
  jobId: string,
  since: string,
): Promise<JobLog[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      id, job_id, level, message, metadata, created_at
    FROM job_logs
    WHERE job_id = ${jobId} AND created_at > ${since}
    ORDER BY created_at ASC
  `;
  return rows.map(mapJobLog);
}
