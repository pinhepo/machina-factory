import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { isAuthenticated } from "./auth";
import { getJobs } from "./db";
import { JobListPoller } from "./job-list-poller";
import { JobList } from "./job-list";

export const dynamic = "force-dynamic";

export default async function FactoryPage() {
  if (!(await isAuthenticated())) {
    redirect("/factory/login");
  }

  const jobs = await getJobs();

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.filter(
    (j) =>
      j.status === "running" ||
      j.status === "provisioning" ||
      j.status === "verifying" ||
      j.status === "committing" ||
      j.status === "deploying" ||
      j.status === "queued",
  ).length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const hasActiveJobs = running > 0;

  return (
    <div className="space-y-5">
      <JobListPoller hasActiveJobs={hasActiveJobs} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Jobs
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {total} total &middot;{" "}
            <span className="text-emerald-500">{completed} completed</span>
            {running > 0 && (
              <>
                {" "}
                &middot;{" "}
                <span className="text-yellow-500">{running} running</span>
              </>
            )}
            {failed > 0 && (
              <>
                {" "}
                &middot; <span className="text-red-500">{failed} failed</span>
              </>
            )}
          </p>
        </div>
        <Link
          href="/factory/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[#fe591f] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#fe591f]/90"
        >
          <Plus className="h-4 w-4" />
          New Job
        </Link>
      </div>

      {/* Job List (client component with search + filters) */}
      <JobList jobs={jobs} />
    </div>
  );
}
