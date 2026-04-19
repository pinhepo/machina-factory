import { NextResponse } from "next/server";
import { isAuthenticated } from "../../../../auth";
import { cancelJob } from "../../../../db";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const result = await cancelJob(jobId);

  if (result.ok) {
    return NextResponse.json({ id: jobId, status: result.status });
  }

  if (result.reason === "not-found") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      error: `Job is already ${result.status}`,
      id: jobId,
      status: result.status,
    },
    { status: 400 },
  );
}
