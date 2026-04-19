"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  GitBranch,
  GitCommit,
  FileCode,
  Plus,
  Minus,
  Clock,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  SkipForward,
  FileText,
  FilePen,
  FilePlus2,
  Search,
  Terminal,
  Globe,
  FolderSearch,
  AlertTriangle,
  RotateCcw,
  Rocket,
  Ban,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StatusBadge } from "../components/status-badge";
import type { Job, JobStep, JobLog } from "../db";
import {
  ClarifyingQuestionsCard,
  type ClarifyingQuestion,
} from "./_components/clarifying-questions-card";
import { MessageCard } from "./_components/message-card";
import { PlanCard, type PlanItem } from "./_components/plan-card";

const ACTIVE_STATUSES = new Set([
  "queued",
  "provisioning",
  "running",
  "verifying",
  "committing",
  "deploying",
]);

const STEP_LABELS: Record<string, string> = {
  clone: "Clone Repository",
  clone_refs: "Clone Reference Repos",
  agent_loop: "Agent Loop",
  verify_tests: "Verify Tests",
  verify_lint: "Verify Lint",
  verify_build: "Verify Build",
  verify_typecheck: "Verify Typecheck",
  commit: "Commit Changes",
  push: "Push Branch",
  create_pr: "Create Pull Request",
  deploy_templates: "Deploy Templates",
  deploy_trigger: "Trigger Redeploy",
};

const LOG_LEVEL_STYLES: Record<string, string> = {
  info: "text-emerald-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-zinc-500",
};

function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildContinueUrl(job: Job): string {
  const params = new URLSearchParams();
  params.set("repoOwner", job.repoOwner);
  params.set("repoName", job.repoName);
  // Use the work branch so the new job starts from the previous job's changes
  params.set("baseBranch", job.workBranch);
  // Pass the work branch explicitly so the new job commits to the SAME branch
  params.set("workBranch", job.workBranch);
  if (job.modelId) params.set("modelId", job.modelId);
  if (job.referenceRepos && job.referenceRepos.length > 0) {
    params.set("refs", JSON.stringify(job.referenceRepos));
  }
  params.set("continueFrom", job.id);
  params.set("prevTask", job.task);
  return `/factory/new?${params.toString()}`;
}

export function JobDetailLive({
  initialJob,
  initialSteps,
  initialLogs,
  childrenJobs,
}: {
  initialJob: Job;
  initialSteps: JobStep[];
  initialLogs: JobLog[];
  childrenJobs: Job[];
}) {
  const [job, setJob] = useState(initialJob);
  const [steps, setSteps] = useState(initialSteps);
  const [logs, setLogs] = useState(initialLogs);
  const [elapsed, setElapsed] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const prevStatusRef = useRef(initialJob.status);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const isActive = ACTIVE_STATUSES.has(job.status);

  // Poll for job + steps updates
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/factory/api/jobs/${job.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setJob(data.job);
        setSteps(data.steps);
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isActive, job.id]);

  // Poll for new logs (incremental)
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(async () => {
      try {
        const lastLog = logs[logs.length - 1];
        const since = lastLog?.createdAt ?? new Date(0).toISOString();
        const res = await fetch(
          `/factory/api/jobs/${job.id}/logs?since=${encodeURIComponent(since)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.logs.length > 0) {
          setLogs((prev) => {
            const existingIds = new Set(prev.map((l: JobLog) => l.id));
            const newLogs = data.logs.filter(
              (l: JobLog) => !existingIds.has(l.id),
            );
            return newLogs.length > 0 ? [...prev, ...newLogs] : prev;
          });
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isActive, job.id, logs]);

  // Auto-scroll logs
  const scrollToBottom = useCallback(() => {
    const container = logsContainerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;
    if (isNearBottom) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  // Elapsed time counter
  useEffect(() => {
    const startRef = job.startedAt ?? job.createdAt;
    if (!isActive || !startRef) return;
    const update = () => {
      const ms = Date.now() - new Date(startRef).getTime();
      if (ms > 0) {
        setElapsed(formatDurationMs(ms));
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isActive, job.startedAt]);

  // Completion sound
  useEffect(() => {
    if (
      job.status === "completed" &&
      prevStatusRef.current !== "completed" &&
      prevStatusRef.current !== initialJob.status
    ) {
      try {
        new Audio("/Submarine.wav").play();
      } catch {
        // ignore audio errors
      }
    }
    prevStatusRef.current = job.status;
  }, [job.status, initialJob.status]);

  const handleCancel = useCallback(async () => {
    const confirmed = window.confirm(
      "Cancel this job? The worker will stop at its next cooperative checkpoint (may take a moment if the agent is mid-step).",
    );
    if (!confirmed) return;

    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/factory/api/jobs/${job.id}/cancel`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
      };
      if (!res.ok) {
        setCancelError(data.error ?? `Failed (${res.status})`);
        return;
      }
      setJob((prev) => ({
        ...prev,
        status: data.status ?? "cancelled",
        completedAt: new Date().toISOString(),
      }));
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setCancelling(false);
    }
  }, [job.id]);

  const result = job.result as Record<string, unknown> | null;
  const noCodeChanges = result?.noCodeChanges === true;
  const filesChanged = result?.filesChanged as number | undefined;
  const linesAdded = result?.linesAdded as number | undefined;
  const linesRemoved = result?.linesRemoved as number | undefined;
  const commitSha = result?.commitSha as string | undefined;
  const prUrl = result?.prUrl as string | undefined;
  const prNumber = result?.prNumber as number | undefined;
  const deployResults = result?.deployResults as
    | Array<{ templatePath: string; pushed: boolean; error?: string }>
    | undefined;
  const anyDeployPushed =
    !!deployResults && deployResults.some((d) => d.pushed);
  const studioProjectUrl = (() => {
    const ctx = job.projectContext;
    if (!ctx?.projectId) return null;
    // Prefer the Studio origin the ctx was minted from (staging vs prod)
    // so the "Open in Studio" button lands on the same environment the
    // user came from. Fall back to the Factory's own env, then prod.
    const base =
      ctx.studioBaseUrl ||
      process.env.NEXT_PUBLIC_MACHINA_STUDIO_URL ||
      "https://studio.machina.gg";
    return `${base}/project/${ctx.projectId}/templates`;
  })();
  const planRaw = result?.plan as
    | {
        status?: "ready" | "clarify";
        summary?: string;
        items?: PlanItem[];
        questions?: ClarifyingQuestion[];
        reason?: string;
      }
    | undefined;
  const clarifyPlan =
    planRaw?.status === "clarify" && planRaw.questions
      ? {
          questions: planRaw.questions,
          reason: planRaw.reason,
        }
      : null;
  const readyPlan =
    !clarifyPlan && planRaw?.items && planRaw.summary
      ? { summary: planRaw.summary, items: planRaw.items }
      : null;

  return (
    <>
      {/* Job Header */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <StatusBadge status={job.status} />
              {isActive && (
                <span className="inline-flex items-center gap-1.5 text-xs text-yellow-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
                  </span>
                  {elapsed}
                </span>
              )}
              {job.modelId && (
                <span className="text-xs text-zinc-500">{job.modelId}</span>
              )}
              {job.parentJobId && (
                <Link
                  href={`/factory/${job.parentJobId}`}
                  className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  ↑ Child of #{job.parentJobId.slice(0, 8)}
                </Link>
              )}
              {job.queueId && (
                <Link
                  href={`/factory/queue/${job.queueId}`}
                  className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  ← Back to queue{" "}
                  {job.queuePosition ? `(Step ${job.queuePosition})` : ""}
                </Link>
              )}
            </div>
            <TaskBody task={job.task} />
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                <GitBranch className="h-3.5 w-3.5" />
                {job.repoOwner}/{job.repoName}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {job.baseBranch} &larr; {job.workBranch}
              </span>
              {job.createdAt && (
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTimestamp(job.createdAt)}
                </span>
              )}
              {/* Reference repos */}
              {job.referenceRepos && job.referenceRepos.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="font-medium">Refs:</span>
                  {job.referenceRepos.map((ref, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono"
                    >
                      {ref.repoOwner}/{ref.repoName}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {anyDeployPushed && studioProjectUrl && (
              <a
                href={studioProjectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
                title={`Open ${job.projectContext?.name ?? "project"} in Machina Studio`}
              >
                <Rocket className="h-4 w-4" />
                Open in Studio
              </a>
            )}
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                <ExternalLink className="h-4 w-4" />
                PR #{prNumber}
              </a>
            )}
            {(job.status === "completed" || job.status === "failed") && (
              <Link
                href={buildContinueUrl(job)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#fe591f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#fe591f]/90"
              >
                <RotateCcw className="h-4 w-4" />
                Continue
              </Link>
            )}
            {isActive && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition-colors hover:bg-red-100 dark:hover:bg-red-950/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4" />
                )}
                {cancelling ? "Cancelling…" : "Cancel Job"}
              </button>
            )}
          </div>
        </div>

        {cancelError && (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-600 dark:text-red-300">
            {cancelError}
          </div>
        )}

        {job.error && (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Error
            </p>
            <p className="mt-1 font-mono text-xs text-red-500 dark:text-red-300/80">
              {job.error}
            </p>
          </div>
        )}

        {noCodeChanges && (
          <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
              Execution-only job
            </p>
            <p className="mt-1 text-xs text-blue-600 dark:text-blue-300/80">
              The agent ran commands and reported back without changing any
              files, so commit / push / PR / deploy were skipped. The full
              tool trace and final message are in the log stream above — no
              broken state to clean up.
            </p>
          </div>
        )}

        {result &&
          (filesChanged || linesAdded || linesRemoved || commitSha) && (
            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              {filesChanged !== undefined && (
                <span className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                  <FileCode className="h-4 w-4" />
                  {filesChanged} file{filesChanged !== 1 ? "s" : ""} changed
                </span>
              )}
              {linesAdded !== undefined && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                  <Plus className="h-4 w-4" />
                  {linesAdded}
                </span>
              )}
              {linesRemoved !== undefined && (
                <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
                  <Minus className="h-4 w-4" />
                  {linesRemoved}
                </span>
              )}
              {commitSha && (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-500">
                  <GitCommit className="h-4 w-4" />
                  {commitSha.slice(0, 7)}
                </span>
              )}
            </div>
          )}

        {job.usage &&
          (job.usage.totalTokens ||
            job.usage.inputTokens ||
            job.usage.outputTokens) && <UsageCard usage={job.usage} />}

        {deployResults && deployResults.length > 0 && (
          <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              <Rocket className="h-4 w-4" />
              Deploy Results
            </h3>
            <div className="space-y-1.5">
              {deployResults.map((dr, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {dr.pushed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {dr.templatePath}
                  </span>
                  {dr.error && (
                    <span className="text-xs text-red-400 truncate max-w-xs">
                      {dr.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {childrenJobs && childrenJobs.length > 0 && (
          <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              <GitBranch className="h-4 w-4" />
              Child Jobs
            </h3>
            <div className="flex flex-col gap-2">
              {childrenJobs.map((cj) => (
                <Link
                  key={cj.id}
                  href={`/factory/${cj.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <StatusBadge status={cj.status} />
                    <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">
                      {cj.task}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-400 whitespace-nowrap ml-4">
                    {formatTimestamp(cj.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {clarifyPlan && (
        <MessageCard from="assistant" title="A few questions before we plan">
          <ClarifyingQuestionsCard
            jobId={job.id}
            jobStatus={job.status}
            questions={clarifyPlan.questions}
            reason={clarifyPlan.reason}
          />
        </MessageCard>
      )}

      {readyPlan && (
        <MessageCard from="assistant" title="Proposed execution plan">
          <PlanCard jobId={job.id} jobStatus={job.status} plan={readyPlan} />
        </MessageCard>
      )}

      {/* Steps Timeline */}
      {steps.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Steps
          </h2>
          {/* Progress bar */}
          {isActive && (
            <div className="mb-4 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-[#fe591f] transition-all duration-700 ease-out"
                style={{
                  width: `${(steps.filter((s) => s.status === "completed").length / Math.max(steps.length, 1)) * 100}%`,
                }}
              />
            </div>
          )}
          <div className="space-y-1">
            {steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                isLast={index === steps.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Logs */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Logs
          </h2>
          {isActive && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Live
            </span>
          )}
        </div>
        <div
          ref={logsContainerRef}
          className="max-h-[600px] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed"
        >
          {logs.length === 0 && (
            <div className="text-zinc-600">
              {isActive ? "Waiting for logs..." : "No logs available."}
            </div>
          )}
          {logs.map((log) => (
            <LogLine key={log.id} log={log} />
          ))}
          {isActive && (
            <div className="py-0.5">
              <span className="animate-pulse text-zinc-500">_</span>
            </div>
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </>
  );
}

const TASK_COLLAPSE_THRESHOLD = 600;

function TaskBody({ task }: { task: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = task.length > TASK_COLLAPSE_THRESHOLD;

  return (
    <div className="relative">
      <div
        className={`markdown-body text-[15px] text-zinc-800 dark:text-zinc-100 ${isLong && !expanded ? "max-h-48 overflow-hidden" : ""}`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children, ...props }) => (
              <h1
                className="mt-4 mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50 first:mt-0"
                {...props}
              >
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2
                className="mt-4 mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50 first:mt-0"
                {...props}
              >
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3
                className="mt-3 mb-1.5 text-base font-semibold text-zinc-900 dark:text-zinc-50 first:mt-0"
                {...props}
              >
                {children}
              </h3>
            ),
            p: (props) => (
              <p className="my-2 leading-relaxed first:mt-0" {...props} />
            ),
            ul: (props) => (
              <ul
                className="my-2 list-disc space-y-1 pl-5 marker:text-zinc-400"
                {...props}
              />
            ),
            ol: (props) => (
              <ol
                className="my-2 list-decimal space-y-1 pl-5 marker:text-zinc-400"
                {...props}
              />
            ),
            li: (props) => <li className="leading-relaxed" {...props} />,
            a: ({ children, ...props }) => (
              <a
                className="text-[#fe591f] underline decoration-[#fe591f]/40 underline-offset-2 transition-colors hover:decoration-[#fe591f]"
                rel="noopener noreferrer"
                target="_blank"
                {...props}
              >
                {children}
              </a>
            ),
            code: ({ className, children, ...rest }) => {
              const isBlock = className?.includes("language-");
              if (isBlock) {
                return (
                  <code
                    className={`${className ?? ""} font-mono text-xs`}
                    {...rest}
                  >
                    {children}
                  </code>
                );
              }
              return (
                <code
                  className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                  {...rest}
                >
                  {children}
                </code>
              );
            },
            pre: (props) => (
              <pre
                className="my-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200"
                {...props}
              />
            ),
            blockquote: (props) => (
              <blockquote
                className="my-3 border-zinc-300 border-l-2 pl-3 text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400"
                {...props}
              />
            ),
            table: (props) => (
              <div className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm" {...props} />
              </div>
            ),
            thead: (props) => (
              <thead
                className="border-zinc-200 border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                {...props}
              />
            ),
            th: (props) => (
              <th className="px-3 py-2 text-left font-medium" {...props} />
            ),
            td: (props) => (
              <td
                className="border-zinc-100 border-t px-3 py-2 align-top dark:border-zinc-800"
                {...props}
              />
            ),
            hr: () => (
              <hr className="my-4 border-zinc-200 dark:border-zinc-800" />
            ),
            strong: (props) => (
              <strong
                className="font-semibold text-zinc-900 dark:text-zinc-50"
                {...props}
              />
            ),
          }}
        >
          {task}
        </ReactMarkdown>
      </div>

      {isLong && !expanded && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-zinc-900/80" />
      )}

      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="relative mt-2 text-xs font-medium text-[#fe591f] transition-colors hover:text-[#fe591f]/80"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function StepRow({ step, isLast }: { step: JobStep; isLast: boolean }) {
  const iconMap: Record<string, React.ReactNode> = {
    pending: <Circle className="h-4 w-4 text-zinc-500" />,
    running: (
      <div className="relative">
        <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
        <span className="absolute -inset-1 animate-pulse rounded-full bg-yellow-400/20" />
      </div>
    ),
    completed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    failed: <XCircle className="h-4 w-4 text-red-400" />,
    skipped: <SkipForward className="h-4 w-4 text-zinc-500" />,
  };
  const icon = iconMap[step.status] ?? (
    <Circle className="h-4 w-4 text-zinc-500" />
  );
  const label = STEP_LABELS[step.step] ?? step.step;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="relative flex flex-col items-center">
        {icon}
        {!isLast && (
          <div className="absolute top-5 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
        )}
      </div>
      <div className="flex flex-1 items-center justify-between">
        <span
          className={`text-sm ${step.status === "running" ? "text-zinc-900 dark:text-zinc-100 font-medium" : step.status === "skipped" ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-300"}`}
        >
          {label}
        </span>
        {step.durationMs !== null && (
          <span className="font-mono text-xs text-zinc-500">
            {formatDurationMs(step.durationMs)}
          </span>
        )}
      </div>
    </div>
  );
}

// Tool call pattern: "[step N] tool → target"
const TOOL_PATTERN = /^\[step \d+\] (\w+) → (.+)$/;

const TOOL_ICONS: Record<
  string,
  { icon: React.ReactNode; color: string; label: string }
> = {
  read: {
    icon: <FileText className="h-3.5 w-3.5" />,
    color: "text-blue-400",
    label: "Reading",
  },
  write: {
    icon: <FilePlus2 className="h-3.5 w-3.5" />,
    color: "text-emerald-400",
    label: "Writing",
  },
  edit: {
    icon: <FilePen className="h-3.5 w-3.5" />,
    color: "text-yellow-400",
    label: "Editing",
  },
  glob: {
    icon: <FolderSearch className="h-3.5 w-3.5" />,
    color: "text-purple-400",
    label: "Searching",
  },
  grep: {
    icon: <Search className="h-3.5 w-3.5" />,
    color: "text-purple-400",
    label: "Searching",
  },
  bash: {
    icon: <Terminal className="h-3.5 w-3.5" />,
    color: "text-orange-400",
    label: "Running",
  },
  fetch: {
    icon: <Globe className="h-3.5 w-3.5" />,
    color: "text-cyan-400",
    label: "Fetching",
  },
  task: {
    icon: <Loader2 className="h-3.5 w-3.5" />,
    color: "text-yellow-400",
    label: "Delegating",
  },
  todo: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: "text-zinc-400",
    label: "Planning",
  },
  skill: {
    icon: <FileCode className="h-3.5 w-3.5" />,
    color: "text-cyan-400",
    label: "Using skill",
  },
};

function LogLine({ log }: { log: JobLog }) {
  const timestamp = new Date(log.createdAt).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Check if this is a tool call log
  const toolMatch = log.message.match(TOOL_PATTERN);
  if (toolMatch) {
    const [, tool, target] = toolMatch;
    const info = TOOL_ICONS[tool] ?? {
      icon: <Circle className="h-3.5 w-3.5" />,
      color: "text-zinc-400",
      label: tool,
    };

    return (
      <div className="flex items-start gap-2 py-1 group hover:bg-zinc-900/70 rounded px-1 -mx-1">
        <span className="shrink-0 select-none text-zinc-600 mt-0.5">
          {timestamp}
        </span>
        <span className={`shrink-0 mt-0.5 ${info.color}`}>{info.icon}</span>
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span
            className={`text-[11px] font-medium uppercase tracking-wide shrink-0 ${info.color}`}
          >
            {info.label}
          </span>
          <span className="text-zinc-300 font-mono text-xs break-all truncate">
            {target}
          </span>
        </div>
      </div>
    );
  }

  // Check for warn/error levels
  if (log.level === "warn") {
    return (
      <div className="flex items-start gap-2 py-1 px-1 -mx-1 rounded bg-yellow-950/20">
        <span className="shrink-0 select-none text-zinc-600 mt-0.5">
          {timestamp}
        </span>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-yellow-400" />
        <span className="text-yellow-300 break-all">{log.message}</span>
      </div>
    );
  }

  if (log.level === "error") {
    return (
      <div className="flex items-start gap-2 py-1 px-1 -mx-1 rounded bg-red-950/20">
        <span className="shrink-0 select-none text-zinc-600 mt-0.5">
          {timestamp}
        </span>
        <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
        <span className="text-red-300 break-all">{log.message}</span>
      </div>
    );
  }

  // Default info log
  return (
    <div className="flex items-start gap-2 py-0.5 px-1 -mx-1 hover:bg-zinc-900/50 rounded">
      <span className="shrink-0 select-none text-zinc-600 mt-0.5">
        {timestamp}
      </span>
      <span className="text-zinc-400 break-all">{log.message}</span>
    </div>
  );
}

function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function UsageCard({ usage }: { usage: NonNullable<Job["usage"]> }) {
  const total = usage.totalTokens;
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const cached = usage.cachedInputTokens;
  const reasoning = usage.reasoningTokens;
  const steps = usage.steps;
  const model = usage.modelId;

  return (
    <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
        <Terminal className="h-4 w-4" />
        Token usage
        {steps !== undefined && (
          <span className="text-[10px] font-normal text-zinc-400">
            across {steps} agent step{steps === 1 ? "" : "s"}
          </span>
        )}
      </h3>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {total !== undefined && (
          <Metric label="total" value={formatCompactNumber(total)} highlight />
        )}
        {input !== undefined && (
          <Metric label="input" value={formatCompactNumber(input)} />
        )}
        {output !== undefined && (
          <Metric label="output" value={formatCompactNumber(output)} />
        )}
        {cached !== undefined && cached > 0 && (
          <Metric label="cached" value={formatCompactNumber(cached)} />
        )}
        {reasoning !== undefined && reasoning > 0 && (
          <Metric label="reasoning" value={formatCompactNumber(reasoning)} />
        )}
        {model && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
            {model}
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${
        highlight
          ? "bg-[#fe591f]/10 text-[#fe591f]"
          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
      }`}
    >
      <span className="uppercase tracking-wide text-[9px] opacity-70">
        {label}
      </span>
      <span className="font-mono font-medium text-xs">{value}</span>
    </span>
  );
}
