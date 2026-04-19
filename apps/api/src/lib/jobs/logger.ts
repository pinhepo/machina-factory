import { nanoid } from "nanoid";
import { db } from "../db/client";
import { jobLogs, type JobLogLevel } from "../db/schema";

/**
 * Create a scoped logger for a specific job.
 */
export function createJobLogger(jobId: string) {
  return {
    info: (message: string, metadata?: Record<string, unknown>) =>
      writeLog(jobId, "info", message, metadata),
    warn: (message: string, metadata?: Record<string, unknown>) =>
      writeLog(jobId, "warn", message, metadata),
    error: (message: string, metadata?: Record<string, unknown>) =>
      writeLog(jobId, "error", message, metadata),
    debug: (message: string, metadata?: Record<string, unknown>) =>
      writeLog(jobId, "debug", message, metadata),
  };
}

async function writeLog(
  jobId: string,
  level: JobLogLevel,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(jobLogs).values({
      id: nanoid(),
      jobId,
      level,
      message,
      metadata,
    });
  } catch (error) {
    // Don't let log failures break the job
    console.error(
      `[JobLogger] Failed to write log for job ${jobId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export type JobLogger = ReturnType<typeof createJobLogger>;
