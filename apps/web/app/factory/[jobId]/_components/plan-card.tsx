"use client";

import { useState } from "react";
import { CheckCircle2, GitBranch, Loader2 } from "lucide-react";
import { approvePlan } from "../actions";

export interface PlanItem {
  task: string;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  origin: string;
}

interface Plan {
  summary: string;
  items: PlanItem[];
}

interface Props {
  jobId: string;
  jobStatus: string;
  plan: Plan;
}

export function PlanCard({ jobId, jobStatus, plan }: Props) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    if (!plan.items || plan.items.length === 0) return;
    setApproving(true);
    setError(null);
    try {
      const result = await approvePlan(jobId, plan.items);
      if (result?.error) {
        setError(result.error);
        setApproving(false);
      }
      // On success, the server action redirects — nothing to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve plan");
      setApproving(false);
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        {plan.summary}
      </p>

      <div className="mb-6 space-y-3">
        {plan.items.map((item, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4"
          >
            <div className="mb-2 flex items-center gap-3 text-xs text-zinc-500">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 font-medium">
                {i + 1}
              </span>
              <span className="flex items-center gap-1.5 font-mono">
                <GitBranch className="h-3.5 w-3.5" />
                {item.repoOwner}/{item.repoName} ({item.baseBranch})
              </span>
            </div>
            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {item.task}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleApprove}
        disabled={approving || jobStatus !== "completed"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#fe591f] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#fe591f]/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {approving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        {approving ? "Enqueuing..." : "Approve & Enqueue"}
      </button>
    </div>
  );
}
