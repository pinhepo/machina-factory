import Link from "next/link";
import { ArrowLeft, ListTree } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "../../auth";
import { getSQL, Job, mapJob } from "../../db";
import { QueueView } from "./queue-view";

export const dynamic = "force-dynamic";

async function getQueueJobs(queueId: string): Promise<Job[]> {
  const sql = getSQL();
  const projectId = process.env.FACTORY_PROJECT_ID;
  let rows: Record<string, unknown>[];

  if (projectId) {
    rows = await sql`
      SELECT
        id, project_id, status, task, repo_owner, repo_name,
        base_branch, work_branch, reference_repos, project_context, usage, model_id, result, error,
        started_at, completed_at, created_at, parent_job_id, queue_id, queue_position, origin
      FROM jobs
      WHERE queue_id = ${queueId} AND project_id = ${projectId}
      ORDER BY queue_position ASC NULLS LAST, created_at ASC
    `;
  } else {
    rows = await sql`
      SELECT
        id, project_id, status, task, repo_owner, repo_name,
        base_branch, work_branch, reference_repos, project_context, usage, model_id, result, error,
        started_at, completed_at, created_at, parent_job_id, queue_id, queue_position, origin
      FROM jobs
      WHERE queue_id = ${queueId}
      ORDER BY queue_position ASC NULLS LAST, created_at ASC
    `;
  }
  return rows.map(mapJob);
}

export default async function QueuePage({
  params,
}: {
  params: Promise<{ queueId: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/factory/login");
  }

  const { queueId } = await params;
  const jobs = await getQueueJobs(queueId);

  if (!jobs || jobs.length === 0) {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-8">
      <Link
        href="/factory"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Jobs
      </Link>

      <div className="flex flex-col gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          <ListTree className="h-6 w-6 text-zinc-500" />
          Queue: {queueId.slice(0, 8)}
        </h1>
        <p className="text-sm text-zinc-500">
          This queue contains {jobs.length} job{jobs.length !== 1 ? "s" : ""}{" "}
          grouped together.
        </p>
      </div>

      <QueueView queueId={queueId} jobs={jobs} />
    </div>
  );
}
