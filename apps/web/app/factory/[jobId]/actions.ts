"use server";

import { redirect } from "next/navigation";

export interface ActionResult {
  error?: string;
  redirect?: string;
}

export async function approvePlan(
  jobId: string,
  queueItems: unknown[],
): Promise<ActionResult> {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return { error: "FACTORY_API_URL or FACTORY_API_KEY not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parentJobId: jobId,
        queueItems,
      }),
    });
  } catch (err) {
    return {
      error: `Failed to reach API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: unknown;
    };
    const detailStr = errorData.details
      ? `: ${JSON.stringify(errorData.details)}`
      : "";
    return {
      error: `${errorData.error || `Failed to create queue (${res.status})`}${detailStr}`,
    };
  }

  const data = (await res.json()) as { queueId?: string };
  if (!data.queueId) {
    return { error: "API did not return a queueId" };
  }
  redirect(`/factory/queue/${data.queueId}`);
}

export async function submitClarifications(
  jobId: string,
  answers: Record<string, string>,
): Promise<ActionResult> {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return { error: "FACTORY_API_URL or FACTORY_API_KEY not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/jobs/${jobId}/answers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answers }),
    });
  } catch (err) {
    return {
      error: `Failed to reach API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    return {
      error: errorData.error || `Failed to submit answers (${res.status})`,
    };
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    return { error: "API did not return a job id" };
  }
  redirect(`/factory/${data.id}`);
}
