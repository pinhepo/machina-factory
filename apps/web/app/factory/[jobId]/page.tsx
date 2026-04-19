import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { getJob, getJobSteps, getJobLogs, getJobChildren } from "../db";
import { JobDetailLive } from "./job-detail-live";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/factory/login");
  }

  const { jobId } = await params;
  const [job, steps, logs, children] = await Promise.all([
    getJob(jobId),
    getJobSteps(jobId),
    getJobLogs(jobId),
    getJobChildren(jobId),
  ]);

  if (!job) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Link
        href="/factory"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Jobs
      </Link>

      <JobDetailLive
        initialJob={job}
        initialSteps={steps}
        initialLogs={logs}
        childrenJobs={children}
      />
    </div>
  );
}
