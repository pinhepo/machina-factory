"use server";

import { redirect } from "next/navigation";
import { verifyStudioCtx } from "../studio-ctx";

export interface CreateJobState {
  error: string | undefined;
}

export async function createJob(
  _prev: CreateJobState,
  formData: FormData,
): Promise<CreateJobState> {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return { error: "FACTORY_API_URL or FACTORY_API_KEY not configured" };
  }

  const task = formData.get("task") as string;
  const baseBranch = (formData.get("baseBranch") as string) || "main";
  const workBranch = (formData.get("workBranch") as string) || undefined;
  const modelId = (formData.get("modelId") as string) || undefined;

  const repoMode = (formData.get("repoMode") as string) || "existing";
  const isCreateMode = repoMode === "create";

  const executionMode = (formData.get("executionMode") as string) || "execute";

  const parentJobId = formData.get("parentJobId") as string | null;
  const origin = formData.get("origin") as string | null;

  if (!task) {
    return { error: "Task is required" };
  }

  // Parse reference repos from hidden JSON field
  let referenceRepos: Array<{
    repoOwner: string;
    repoName: string;
    branch?: string;
  }> = [];
  try {
    const refsRaw = formData.get("referenceRepos") as string;
    if (refsRaw) {
      referenceRepos = JSON.parse(refsRaw);
    }
  } catch {
    // ignore parse errors
  }

  const body: Record<string, unknown> = { task, baseBranch };

  if (isCreateMode) {
    const newRepoOrg =
      (formData.get("newRepoOrg") as string) || "machina-sports";
    const newRepoName = (formData.get("newRepoName") as string) || "";
    const newRepoPrivate = formData.get("newRepoPrivate") === "on";
    const fromRepoRaw = formData.get("fromRepo") as string;

    if (!newRepoName) {
      return { error: "New repo name is required" };
    }
    if (!fromRepoRaw) {
      return { error: "Select a base repo to scaffold from" };
    }

    let fromRepo: { repoOwner: string; repoName: string; branch?: string };
    try {
      fromRepo = JSON.parse(fromRepoRaw);
    } catch {
      return { error: "Invalid base repo selection" };
    }

    body.createRepo = {
      org: newRepoOrg,
      name: newRepoName,
      fromRepo,
      private: newRepoPrivate,
    };
  } else {
    const repoOwner = formData.get("repoOwner") as string;
    const repoName = formData.get("repoName") as string;
    if (!repoOwner || !repoName) {
      return { error: "Repo owner and repo name are required" };
    }
    body.repoOwner = repoOwner;
    body.repoName = repoName;
  }

  if (workBranch) {
    body.workBranch = workBranch;
  }
  if (modelId) {
    body.modelId = modelId;
  }

  if (referenceRepos.length > 0) {
    body.referenceRepos = referenceRepos;
  }

  if (parentJobId) body.parentJobId = parentJobId;
  if (origin) body.origin = origin;

  const studioCtxToken = formData.get("studioCtxToken") as string | null;
  if (studioCtxToken) {
    const ctx = verifyStudioCtx(studioCtxToken);
    if (ctx) {
      body.projectContext = ctx;
      body.origin = body.origin ?? "machina_client";
    }
  }

  body.mode = executionMode;

  const res = await fetch(`${apiUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `API error (${res.status}): ${text}` };
  }

  const data = (await res.json()) as { id: string };
  redirect(`/factory/${data.id}`);
}
