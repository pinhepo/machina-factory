import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { jobSteps, type JobStepStatus, type JobStepType } from "../db/schema";

/**
 * Create and start tracking a job step.
 */
export async function startStep(
  jobId: string,
  step: JobStepType,
): Promise<string> {
  const id = nanoid();
  await db.insert(jobSteps).values({
    id,
    jobId,
    step,
    status: "running",
    startedAt: new Date(),
  });
  return id;
}

/**
 * Complete a job step with output.
 */
export async function completeStep(
  stepId: string,
  status: JobStepStatus,
  output?: unknown,
): Promise<void> {
  const now = new Date();

  // Get start time for duration calculation
  const step = await db
    .select({ startedAt: jobSteps.startedAt })
    .from(jobSteps)
    .where(eq(jobSteps.id, stepId))
    .limit(1);

  const startedAt = step[0]?.startedAt;
  const durationMs = startedAt
    ? now.getTime() - startedAt.getTime()
    : undefined;

  await db
    .update(jobSteps)
    .set({
      status,
      output: output ?? null,
      completedAt: now,
      durationMs,
    })
    .where(eq(jobSteps.id, stepId));
}
