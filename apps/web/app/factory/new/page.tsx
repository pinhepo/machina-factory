import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { isAuthenticated } from "../auth";
import { verifyStudioCtx } from "../studio-ctx";
import { NewJobForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  // A valid signed `ctx` token from Studio is itself proof of a valid
  // Studio session — Studio only mints tokens for authenticated users.
  // This lets the cross-origin iframe embed work without shared cookies.
  const studioCtx = params.ctx ? verifyStudioCtx(params.ctx) : null;

  // Middleware has already minted the `factory-studio-auth` cookie when
  // the ctx verified, so `isAuthenticated()` picks that up here too.
  if (!studioCtx && !(await isAuthenticated())) {
    redirect("/factory/login");
  }

  // Parse reference repos from query params
  let prefillRefs: Array<{
    repoOwner: string;
    repoName: string;
    branch?: string;
  }> = [];
  if (params.refs) {
    try {
      prefillRefs = JSON.parse(params.refs);
    } catch {
      // ignore
    }
  }

  const suggested = studioCtx?.suggestedRepo;
  const prefill = {
    repoOwner: params.repoOwner ?? suggested?.owner,
    repoName: params.repoName ?? suggested?.name,
    baseBranch: params.baseBranch ?? suggested?.branch,
    workBranch: params.workBranch,
    modelId: params.modelId,
    referenceRepos: prefillRefs,
    continueFrom: params.continueFrom,
    prevTask: params.prevTask,
    studioCtxToken: params.ctx,
    studioProjectName: studioCtx?.name,
  };

  const isContinuation = Boolean(params.continueFrom);

  return (
    <div className="space-y-6">
      <Link
        href={
          params.continueFrom ? `/factory/${params.continueFrom}` : "/factory"
        }
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        {isContinuation ? "Back to Job" : "Back to Jobs"}
      </Link>

      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-lg font-semibold">
          {isContinuation ? "Continue Job" : "Create New Job"}
        </h1>
        {!isContinuation && (
          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            Factory ships code — describe what to build, fix, or refactor.
            Not what to run.
          </p>
        )}
        {isContinuation && params.prevTask && (
          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            Continuing from:{" "}
            <span className="text-zinc-700 dark:text-zinc-300">
              {params.prevTask.slice(0, 120)}
            </span>
            <br />
            Branch:{" "}
            <code className="text-xs font-mono text-[#fe591f]">
              {params.baseBranch}
            </code>
          </p>
        )}
        <NewJobForm prefill={prefill} />
      </div>
    </div>
  );
}
