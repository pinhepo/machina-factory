import { eq } from "drizzle-orm";
import { db } from "./lib/db/client";
import { projects } from "./lib/db/schema";
import {
  findInstallationForOwner,
  getInstallationToken,
} from "./lib/github/app-auth";
import { claimNextJob, updateJobStatus } from "./lib/jobs/queue";
import { runJob } from "./lib/jobs/runner";
import { createJobLogger } from "./lib/jobs/logger";

const POLL_INTERVAL_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("Machina Factory Worker starting...");

/**
 * Main worker loop.
 * Polls the jobs table for queued jobs and executes them.
 */
async function workerLoop(): Promise<void> {
  while (true) {
    try {
      const job = await claimNextJob();

      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`[Worker] Claimed job ${job.id}: ${job.task.slice(0, 80)}`);
      const log = createJobLogger(job.id);

      // Resolve GitHub installation token for the repo
      const installationId = await findInstallationForOwner(job.repoOwner);
      if (!installationId) {
        const error = `No GitHub App installation found for ${job.repoOwner}. Install the GitHub App on the repository owner's account.`;
        await log.error(error);
        await updateJobStatus(job.id, "failed", {
          error,
          completedAt: new Date(),
        });
        continue;
      }

      const githubToken = await getInstallationToken(installationId);

      // Fetch project deploy config (per-job config overrides project settings)
      const projectRows = await db
        .select({
          settings: projects.settings,
          machinaOrgId: projects.machinaOrgId,
          machinaProjectId: projects.machinaProjectId,
        })
        .from(projects)
        .where(eq(projects.id, job.projectId))
        .limit(1);
      const project = projectRows[0];
      const projectDeploy = project?.settings?.deploy;
      const deployConfig = job.deployConfig
        ? { ...projectDeploy, ...job.deployConfig }
        : projectDeploy;

      await runJob(job, {
        githubToken,
        gitUser: {
          name: "Machina Factory",
          email: "factory@machina.gg",
        },
        deployConfig,
        machinaOrgId: project?.machinaOrgId,
        machinaProjectId: project?.machinaProjectId,
      });

      console.log(`[Worker] Job ${job.id} finished`);
    } catch (error) {
      console.error(
        "[Worker] Unexpected error:",
        error instanceof Error ? error.message : error,
      );
      // Wait before retrying to avoid tight error loops
      await sleep(5_000);
    }
  }
}

workerLoop().catch((error) => {
  console.error("[Worker] Fatal error:", error);
  process.exit(1);
});
