"use client";

import { useState } from "react";
import Link from "next/link";
import { Job } from "../../db";
import { JobList } from "../../job-list";
import { Loader2, Play, SkipForward, XCircle } from "lucide-react";
import {
  advanceQueueAction,
  skipQueueItemAction,
  cancelQueueAction,
} from "./actions";

export function QueueView({ queueId, jobs }: { queueId: string; jobs: Job[] }) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Determine current state
  const activeItems = jobs.filter((j) =>
    [
      "queued",
      "provisioning",
      "running",
      "verifying",
      "committing",
      "deploying",
    ].includes(j.status),
  );

  const pausedItems = jobs.filter((j) => j.status === "paused");

  const nextPausedItem = pausedItems.length > 0 ? pausedItems[0] : null;

  const handleAction = async (
    actionFn: () => Promise<{ error?: string; success?: boolean }>,
    actionName: string,
  ) => {
    setLoadingAction(actionName);
    setError(null);
    try {
      const res = await actionFn();
      if (res.error) {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAdvance = () =>
    handleAction(() => advanceQueueAction(queueId), "advance");
  const handleSkip = () =>
    handleAction(() => skipQueueItemAction(queueId), "skip");
  const handleCancel = () => {
    if (confirm("Are you sure you want to cancel the rest of the queue?")) {
      handleAction(() => cancelQueueAction(queueId), "cancel");
    }
  };

  const allDone = activeItems.length === 0 && pausedItems.length === 0;

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Focus Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-4">
          Queue Status
        </h2>

        {allDone ? (
          <div className="text-zinc-500 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-zinc-400" />
            Queue finished
          </div>
        ) : activeItems.length > 0 ? (
          <div className="flex items-center gap-3 text-[#fe591f] font-medium">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>In progress: {activeItems[0].task}</span>
            <Link
              href={`/factory/${activeItems[0].id}`}
              className="ml-auto text-sm bg-[#fe591f]/10 px-3 py-1.5 rounded-md hover:bg-[#fe591f]/20 transition-colors"
            >
              View live job →
            </Link>
          </div>
        ) : nextPausedItem ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-sm text-zinc-500 mb-1">Next up</div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {nextPausedItem.task}
                </div>
                <div className="text-sm text-zinc-400 font-mono mt-1">
                  {nextPausedItem.repoOwner}/{nextPausedItem.repoName}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleAdvance}
                disabled={loadingAction !== null}
                className="flex items-center gap-2 px-4 py-2 bg-[#fe591f] hover:bg-[#e04f1c] text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loadingAction === "advance" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Approve & Run
              </button>

              <button
                onClick={handleSkip}
                disabled={loadingAction !== null}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loadingAction === "skip" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SkipForward className="h-4 w-4" />
                )}
                Skip
              </button>

              <button
                onClick={handleCancel}
                disabled={loadingAction !== null}
                className="ml-auto text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
              >
                Cancel queue
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
          Queue Items
        </h3>
        <JobList jobs={jobs} />
      </div>
    </div>
  );
}
