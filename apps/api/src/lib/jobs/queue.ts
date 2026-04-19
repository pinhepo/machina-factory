import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { jobs, type Job } from "../db/schema";

/**
 * Claim the next queued job using SELECT FOR UPDATE SKIP LOCKED.
 * Returns the job if one was claimed, null otherwise.
 */
export async function claimNextJob(): Promise<Job | null> {
  // Use raw SQL for FOR UPDATE SKIP LOCKED which Drizzle doesn't support natively
  const result = await db.execute(
    sql`
      UPDATE ${jobs}
      SET status = 'provisioning',
          started_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM ${jobs}
        WHERE status = 'queued' -- Note: paused queue items are NOT claimed until explicitly advanced
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `,
  );

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) {
    return null;
  }

  // Map the snake_case columns back to camelCase
  const row = rows[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    externalId: row.external_id as string | null,
    status: "provisioning" as const,
    task: row.task as string,
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    baseBranch: row.base_branch as string,
    workBranch: row.work_branch as string,
    sandboxState: row.sandbox_state as Job["sandboxState"],
    sandboxWorkingDirectory: row.sandbox_working_directory as string | null,
    agentMessages: row.agent_messages as Job["agentMessages"],
    referenceRepos: row.reference_repos as Job["referenceRepos"],
    createRepoConfig: row.create_repo_config as Job["createRepoConfig"],
    deployConfig: row.deploy_config as Job["deployConfig"],
    projectContext: row.project_context as Job["projectContext"],
    usage: row.usage as Job["usage"],
    modelId: row.model_id as string | null,
    result: row.result as Job["result"],
    error: row.error as string | null,
    callbackUrl: row.callback_url as string | null,
    startedAt: row.started_at ? new Date(row.started_at as string) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    parentJobId: row.parent_job_id as string | null,
    queueId: row.queue_id as string | null,
    queuePosition: row.queue_position as number | null,
    origin: row.origin as Job["origin"],
    mode: row.mode as Job["mode"],
  };
}

/**
 * Update job status.
 */
export async function updateJobStatus(
  jobId: string,
  status: Job["status"],
  extra?: Partial<
    Pick<
      Job,
      | "error"
      | "result"
      | "sandboxState"
      | "agentMessages"
      | "completedAt"
      | "usage"
    >
  >,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      updatedAt: new Date(),
      ...extra,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Check if a job has been cancelled.
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const result = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  return result.length > 0 && result[0]?.status === "cancelled";
}
