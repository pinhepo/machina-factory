import { NextResponse } from "next/server";
import { getJob, getJobSteps } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const [job, steps] = await Promise.all([getJob(jobId), getJobSteps(jobId)]);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job, steps });
}
