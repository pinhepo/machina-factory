"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  FileCode,
  FilePen,
  FilePlus2,
  FileText,
  FolderSearch,
  GitBranch,
  GitCommit,
  Globe,
  ListChecks,
  Loader2,
  Minus,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  SkipForward,
  Terminal,
  XCircle,
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

// ─────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set([
  "queued",
  "provisioning",
  "running",
  "verifying",
  "committing",
  "deploying",
]);

const STEP_LABELS: Record<string, string> = {
  clone: "Clone repository",
  clone_refs: "Clone reference repos",
  agent_loop: "Agent loop",
  verify_tests: "Verify tests",
  verify_lint: "Verify lint",
  verify_build: "Verify build",
  verify_typecheck: "Verify typecheck",
  commit: "Commit changes",
  push: "Push branch",
  create_pr: "Create pull request",
  deploy_templates: "Deploy templates",
  deploy_trigger: "Trigger redeploy",
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
    hour12: false,
  });
}

function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function buildContinueUrl(job: Job): string {
  const params = new URLSearchParams();
  params.set("repoOwner", job.repoOwner);
  params.set("repoName", job.repoName);
  params.set("baseBranch", job.workBranch);
  params.set("workBranch", job.workBranch);
  if (job.modelId) params.set("modelId", job.modelId);
  if (job.referenceRepos && job.referenceRepos.length > 0) {
    params.set("refs", JSON.stringify(job.referenceRepos));
  }
  params.set("continueFrom", job.id);
  params.set("prevTask", job.task);
  return `/factory/new?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

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
      logsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
      if (ms > 0) setElapsed(formatDurationMs(ms));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isActive, job.startedAt, job.createdAt]);

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
      ? { questions: planRaw.questions, reason: planRaw.reason }
      : null;
  const readyPlan =
    !clarifyPlan && planRaw?.items && planRaw.summary
      ? { summary: planRaw.summary, items: planRaw.items }
      : null;

  return (
    <div className="grid grid-cols-12 gap-5 lg:h-[calc(100vh-9rem)]">
      <style>{`
        @keyframes jd-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .jd-progress { animation: jd-progress 2.2s ease-in-out infinite; }
      `}</style>      {/* ─────────────  LEFT — header, pipeline, usage, artifacts  ───────────── */}
      <aside className="col-span-12 lg:col-span-5 xl:col-span-4 flex flex-col gap-4 lg:overflow-auto pr-1 scrollbar-thin">
        <JobStatusHeader
          job={job}
          isActive={isActive}
          elapsed={elapsed}
          cancelling={cancelling}
          onCancel={handleCancel}
          cancelError={cancelError}
          studioProjectUrl={studioProjectUrl}
          anyDeployPushed={anyDeployPushed}
          prUrl={prUrl}
          prNumber={prNumber}
        />

        {job.error && (
          <InlineBanner
            tone="error"
            title="Error"
            body={<span className="font-mono text-xs">{job.error}</span>}
          />
        )}

        {noCodeChanges && (
          <InlineBanner
            tone="info"
            title="Execution-only job"
            body={
              <span>
                The agent ran commands and reported back without changing any
                files, so commit / push / PR / deploy were skipped.
              </span>
            }
          />
        )}

        <PipelineRail steps={steps} isActive={isActive} />

        {result &&
          (filesChanged || linesAdded || linesRemoved || commitSha) && (
            <DiffSummary
              filesChanged={filesChanged}
              linesAdded={linesAdded}
              linesRemoved={linesRemoved}
              commitSha={commitSha}
            />
          )}

        {job.usage &&
          (job.usage.totalTokens ||
            job.usage.inputTokens ||
            job.usage.outputTokens) && <UsageCard usage={job.usage} />}

        {deployResults && deployResults.length > 0 && (
          <DeployResultsCard results={deployResults} />
        )}

        {childrenJobs && childrenJobs.length > 0 && (
          <ChildrenJobsCard jobs={childrenJobs} />
        )}
      </aside>

      {/* ─────────────  RIGHT — task + assistant cards + logs (hero)  ───────────── */}
      <main className="col-span-12 lg:col-span-7 xl:col-span-8 flex flex-col gap-4 min-h-[640px] lg:min-h-0">
        <TaskPanel task={job.task} />

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

        <LogsPanel
          logs={logs}
          isActive={isActive}
          containerRef={logsContainerRef}
          endRef={logsEndRef}
        />
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Status header
// ─────────────────────────────────────────────────────────────────────────

function JobStatusHeader({
  job,
  isActive,
  elapsed,
  cancelling,
  onCancel,
  cancelError,
  studioProjectUrl,
  anyDeployPushed,
  prUrl,
  prNumber,
}: {
  job: Job;
  isActive: boolean;
  elapsed: string;
  cancelling: boolean;
  onCancel: () => void;
  cancelError: string | null;
  studioProjectUrl: string | null;
  anyDeployPushed: boolean;
  prUrl?: string;
  prNumber?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copyId = useCallback(() => {
    navigator.clipboard?.writeText(job.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [job.id]);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={job.status} />
        {isActive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-yellow-600 dark:text-yellow-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
            </span>
            <span className="font-mono tabular-nums">{elapsed}</span>
          </span>
        )}
        {job.modelId && (
          <span className="text-[11px] font-mono text-zinc-500">
            {job.modelId}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copyId}
            title={copied ? "Copied" : `Copy job ID (${job.id})`}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            <Copy className="h-3 w-3" />
            {job.id.slice(-7)}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5 font-mono truncate">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {job.repoOwner}/{job.repoName}
          </span>
        </span>
        <span className="font-mono text-[11.5px] truncate">
          <span className="text-zinc-400">{job.baseBranch}</span>
          <span className="mx-1.5 text-zinc-300">←</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {job.workBranch}
          </span>
        </span>
        {job.createdAt && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px]">
            <Clock className="h-3.5 w-3.5" />
            created {formatTimestamp(job.createdAt)}
          </span>
        )}
      </div>

      {job.referenceRepos && job.referenceRepos.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="uppercase tracking-wide text-[10px] font-semibold text-zinc-400">
            Refs
          </span>
          {job.referenceRepos.map((ref, i) => (
            <span
              key={i}
              className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-zinc-600 dark:text-zinc-300"
            >
              {ref.repoOwner}/{ref.repoName}
            </span>
          ))}
        </div>
      )}

      {(job.parentJobId || job.queueId) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          {job.parentJobId && (
            <Link
              href={`/factory/${job.parentJobId}`}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              ↑ Child of #{job.parentJobId.slice(0, 8)}
            </Link>
          )}
          {job.queueId && (
            <Link
              href={`/factory/queue/${job.queueId}`}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              ← Back to queue
              {job.queuePosition ? ` (Step ${job.queuePosition})` : ""}
            </Link>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {anyDeployPushed && studioProjectUrl && (
          <a
            href={studioProjectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors"
          >
            <Rocket className="h-3.5 w-3.5" />
            Open in Studio
          </a>
        )}
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 px-3 py-1.5 text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            PR #{prNumber}
          </a>
        )}
        {(job.status === "completed" || job.status === "failed") && (
          <Link
            href={buildContinueUrl(job)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#fe591f] hover:bg-[#fe591f]/90 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Continue
          </Link>
        )}
        {isActive && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/70 px-3 py-1.5 text-[12.5px] font-medium text-red-600 dark:text-red-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ban className="h-3.5 w-3.5" />
            )}
            {cancelling ? "Cancelling…" : "Cancel job"}
          </button>
        )}
      </div>

      {cancelError && (
        <div className="mt-3 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-[12px] text-red-600 dark:text-red-300">
          {cancelError}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline rail
// ─────────────────────────────────────────────────────────────────────────

function PipelineRail({
  steps,
  isActive,
}: {
  steps: JobStep[];
  isActive: boolean;
}) {
  if (steps.length === 0) return null;
  const completed = steps.filter((s) => s.status === "completed").length;
  const pct = Math.round((completed / Math.max(steps.length, 1)) * 100);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h3 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase">
            Pipeline
          </h3>
          <p className="text-[11.5px] text-zinc-400 mt-0.5">
            {completed} of {steps.length} steps complete
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-20 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-[#fe591f] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {pct}%
          </span>
        </div>
      </header>

      <ol className="px-4 py-3">
        {steps.map((step, index) => (
          <PipelineStep
            key={step.id}
            step={step}
            isLast={index === steps.length - 1}
            isActive={isActive}
          />
        ))}
      </ol>
    </section>
  );
}

function PipelineStep({
  step,
  isLast,
  isActive,
}: {
  step: JobStep;
  isLast: boolean;
  isActive: boolean;
}) {
  const running = step.status === "running";
  const done = step.status === "completed";
  const pending = step.status === "pending";
  const failed = step.status === "failed";
  const skipped = step.status === "skipped";
  const label = STEP_LABELS[step.step] ?? step.step;

  const icon = done ? (
    <CheckCircle2 className="h-3 w-3 text-emerald-600" strokeWidth={2.5} />
  ) : failed ? (
    <XCircle className="h-3 w-3 text-red-600" strokeWidth={2.5} />
  ) : running ? (
    <Loader2 className="h-3 w-3 text-amber-600 animate-spin" />
  ) : skipped ? (
    <SkipForward className="h-3 w-3 text-zinc-400" />
  ) : (
    <Circle className="h-2.5 w-2.5 text-zinc-300" />
  );

  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!isLast && (
        <span
          className={`absolute left-[11px] top-5 bottom-0 w-px ${
            done
              ? "bg-emerald-300 dark:bg-emerald-800"
              : running
                ? "bg-gradient-to-b from-amber-300 to-zinc-200 dark:to-zinc-700"
                : "bg-zinc-200 dark:bg-zinc-800"
          }`}
        />
      )}
      <span
        className={`relative z-10 w-[22px] h-[22px] rounded-full grid place-items-center shrink-0 ring-2 ring-white dark:ring-zinc-900 ${
          done
            ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900"
            : running
              ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900"
              : failed
                ? "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900"
                : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
        }`}
      >
        {icon}
        {running && isActive && (
          <span className="absolute inset-[-3px] rounded-full ring-2 ring-amber-400/40 animate-ping" />
        )}
      </span>
      <div className="flex-1 min-w-0 -mt-[1px]">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`text-[13px] truncate ${
              running
                ? "font-medium text-zinc-900 dark:text-zinc-100"
                : pending
                  ? "text-zinc-400 dark:text-zinc-600"
                  : skipped
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {label}
          </span>
          {step.durationMs != null && (
            <span className="font-mono text-[10.5px] text-zinc-400 tabular-nums shrink-0">
              {formatDurationMs(step.durationMs)}
            </span>
          )}
          {running && (
            <span className="text-[10.5px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
              in progress…
            </span>
          )}
        </div>
        {running && (
          <div className="mt-1.5 h-0.5 rounded-full bg-amber-100 dark:bg-amber-950 overflow-hidden relative">
            <div className="absolute inset-y-0 w-1/3 bg-amber-400 jd-progress" />
          </div>
        )}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Task panel (markdown)
// ─────────────────────────────────────────────────────────────────────────

const TASK_COLLAPSE_THRESHOLD = 600;

function TaskPanel({ task }: { task: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = task.length > TASK_COLLAPSE_THRESHOLD;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-5">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-zinc-400" />
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase">
            Task
          </h2>
        </div>
      </header>
      <div className="relative">
        <div
          className={`markdown-body text-[14px] text-zinc-800 dark:text-zinc-100 ${
            isLong && !expanded ? "max-h-48 overflow-hidden" : ""
          }`}
        >
          <TaskMarkdown task={task} />
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
    </section>
  );
}

function TaskMarkdown({ task }: { task: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children, ...props }) => (
          <h1
            className="mt-4 mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50 first:mt-0"
            {...props}
          >
            {children}
          </h1>
        ),
        h2: ({ children, ...props }) => (
          <h2
            className="mt-4 mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50 first:mt-0"
            {...props}
          >
            {children}
          </h2>
        ),
        h3: ({ children, ...props }) => (
          <h3
            className="mt-3 mb-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50 first:mt-0"
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
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Logs panel (hero)
// ─────────────────────────────────────────────────────────────────────────

const TOOL_PATTERN = /^\[step (\d+)\] (\w+) → (.+)$/;

const TOOL_META: Record<
  string,
  { label: string; icon: React.ReactNode; tint: string }
> = {
  read: {
    label: "Read",
    icon: <FileText className="h-3 w-3" />,
    tint: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  },
  write: {
    label: "Write",
    icon: <FilePlus2 className="h-3 w-3" />,
    tint: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  },
  edit: {
    label: "Edit",
    icon: <FilePen className="h-3 w-3" />,
    tint: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  },
  glob: {
    label: "Glob",
    icon: <FolderSearch className="h-3 w-3" />,
    tint: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  },
  grep: {
    label: "Grep",
    icon: <Search className="h-3 w-3" />,
    tint: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  },
  bash: {
    label: "Bash",
    icon: <Terminal className="h-3 w-3" />,
    tint: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900",
  },
  fetch: {
    label: "Fetch",
    icon: <Globe className="h-3 w-3" />,
    tint: "bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-900",
  },
  task: {
    label: "Task",
    icon: <Loader2 className="h-3 w-3" />,
    tint: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  },
  todo: {
    label: "Todo",
    icon: <CheckCircle2 className="h-3 w-3" />,
    tint: "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  },
  skill: {
    label: "Skill",
    icon: <FileCode className="h-3 w-3" />,
    tint: "bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-900",
  },
};

function LogsPanel({
  logs,
  isActive,
  containerRef,
  endRef,
}: {
  logs: JobLog[];
  isActive: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [q, setQ] = useState("");
  const [levels, setLevels] = useState({
    info: true,
    warn: true,
    error: true,
  });

  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (!levels[l.level as keyof typeof levels]) return false;
        if (q && !l.message.toLowerCase().includes(q.toLowerCase()))
          return false;
        return true;
      }),
    [logs, levels, q],
  );

  const counts = useMemo(
    () => ({
      info: logs.filter((l) => l.level === "info").length,
      warn: logs.filter((l) => l.level === "warn").length,
      error: logs.filter((l) => l.level === "error").length,
    }),
    [logs],
  );

  const levelChip = (
    lv: "info" | "warn" | "error",
    color: "emerald" | "amber" | "red",
  ) => {
    const on = levels[lv];
    const onStyles = {
      emerald:
        "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300",
      amber:
        "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300",
      red: "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300",
    }[color];
    const dotStyles = {
      emerald: "bg-emerald-500",
      amber: "bg-amber-500",
      red: "bg-red-500",
    }[color];
    return (
      <button
        key={lv}
        type="button"
        onClick={() => setLevels((s) => ({ ...s, [lv]: !s[lv] }))}
        className={`inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-[3px] rounded border transition-colors ${
          on
            ? onStyles
            : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-400"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${on ? dotStyles : "bg-zinc-300"}`}
        />
        {lv}{" "}
        <span className="tabular-nums opacity-70">{counts[lv]}</span>
      </button>
    );
  };

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden flex flex-col flex-1 min-h-0">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/80 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-zinc-400" />
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase">
            Live output
          </h2>
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded px-1.5 py-[1px]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live · {logs.length} lines
            </span>
          ) : (
            <span className="text-[10.5px] text-zinc-400 tabular-nums">
              {logs.length} lines
            </span>
          )}
        </div>

        <div className="relative ml-auto">
          <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter logs…"
            className="h-7 w-48 pl-6 pr-2 text-[12px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md focus:outline-none focus:ring-2 focus:ring-[#fe591f]/30 focus:border-[#fe591f]/50"
          />
        </div>

        <div className="flex items-center gap-1">
          {levelChip("info", "emerald")}
          {levelChip("warn", "amber")}
          {levelChip("error", "red")}
        </div>
      </header>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto bg-white dark:bg-zinc-950/40"
      >
        {filtered.length === 0 && (
          <div className="px-6 py-8 text-center text-[12.5px] text-zinc-400">
            {q
              ? "No logs match that filter."
              : isActive
                ? "Waiting for output…"
                : "No logs available."}
          </div>
        )}
        <ol className="py-1">
          {filtered.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </ol>
        {isActive && (
          <div className="px-4 py-2 flex items-center gap-2 text-[11.5px] text-zinc-400">
            <span className="font-mono animate-pulse">▍</span>
            <span className="font-mono">agent working…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function LogRow({ log }: { log: JobLog }) {
  const time = formatLogTime(log.createdAt);
  const match = log.message.match(TOOL_PATTERN);

  if (match) {
    const [, stepNum, tool, target] = match;
    const meta =
      TOOL_META[tool] ??
      ({
        label: tool,
        icon: <Circle className="h-3 w-3" />,
        tint: "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
      } as const);
    return (
      <li className="group flex items-start gap-3 px-4 py-1 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
        <span className="font-mono text-[10.5px] text-zinc-400 tabular-nums pt-[3px] select-none w-[58px] shrink-0">
          {time}
        </span>
        <span
          className={`mt-[2px] inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[10px] font-medium ring-1 ring-inset shrink-0 w-[66px] justify-center ${meta.tint}`}
        >
          {meta.icon}
          {meta.label}
        </span>
        <span className="font-mono text-[12px] text-zinc-700 dark:text-zinc-300 min-w-0 break-all">
          {target}
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-300 dark:text-zinc-600 tabular-nums pt-[3px] shrink-0">
          #{stepNum}
        </span>
      </li>
    );
  }

  const isWarn = log.level === "warn";
  const isErr = log.level === "error";

  return (
    <li
      className={`flex items-start gap-3 px-4 py-1 ${
        isErr
          ? "bg-red-50/40 dark:bg-red-950/20"
          : isWarn
            ? "bg-amber-50/40 dark:bg-amber-950/20"
            : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40"
      }`}
    >
      <span className="font-mono text-[10.5px] text-zinc-400 tabular-nums pt-[2px] select-none w-[58px] shrink-0">
        {time}
      </span>
      <span
        className={`mt-[2px] inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[10px] font-medium ring-1 ring-inset shrink-0 w-[66px] justify-center ${
          isErr
            ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
            : isWarn
              ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900"
              : "bg-zinc-50 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
        }`}
      >
        {isErr ? (
          <XCircle className="h-3 w-3" strokeWidth={2.5} />
        ) : isWarn ? (
          <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <span className="h-1 w-1 rounded-full bg-zinc-400" />
        )}
        {log.level}
      </span>
      <span
        className={`text-[12.5px] min-w-0 break-words ${
          isErr
            ? "text-red-800 dark:text-red-300"
            : isWarn
              ? "text-amber-800 dark:text-amber-300"
              : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {log.message}
      </span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Supporting cards
// ─────────────────────────────────────────────────────────────────────────

function InlineBanner({
  tone,
  title,
  body,
}: {
  tone: "info" | "error";
  title: string;
  body: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
      : "border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300";
  return (
    <div className={`rounded-xl border px-4 py-3 ${styles}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs opacity-90">{body}</p>
    </div>
  );
}

function DiffSummary({
  filesChanged,
  linesAdded,
  linesRemoved,
  commitSha,
}: {
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  commitSha?: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-4 py-3">
      <h3 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase mb-2">
        Changes
      </h3>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {filesChanged !== undefined && (
          <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <FileCode className="h-4 w-4" />
            {filesChanged} file{filesChanged !== 1 ? "s" : ""}
          </span>
        )}
        {linesAdded !== undefined && (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Plus className="h-4 w-4" />
            {linesAdded}
          </span>
        )}
        {linesRemoved !== undefined && (
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
            <Minus className="h-4 w-4" />
            {linesRemoved}
          </span>
        )}
        {commitSha && (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-500 ml-auto">
            <GitCommit className="h-3.5 w-3.5" />
            {commitSha.slice(0, 7)}
          </span>
        )}
      </div>
    </section>
  );
}

function UsageCard({ usage }: { usage: NonNullable<Job["usage"]> }) {
  const { totalTokens, inputTokens, outputTokens, cachedInputTokens, reasoningTokens, steps, modelId } = usage;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-4 py-3">
      <header className="flex items-center justify-between mb-2.5">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase">
          Token usage
        </h3>
        {steps !== undefined && (
          <span className="text-[10.5px] text-zinc-400">
            {steps} agent step{steps === 1 ? "" : "s"}
          </span>
        )}
      </header>
      <div className="grid grid-cols-3 gap-2">
        {totalTokens !== undefined && (
          <UsageMetric label="Total" value={formatCompactNumber(totalTokens)} highlight />
        )}
        {inputTokens !== undefined && (
          <UsageMetric label="Input" value={formatCompactNumber(inputTokens)} />
        )}
        {outputTokens !== undefined && (
          <UsageMetric label="Output" value={formatCompactNumber(outputTokens)} />
        )}
        {cachedInputTokens !== undefined && cachedInputTokens > 0 && (
          <UsageMetric label="Cached" value={formatCompactNumber(cachedInputTokens)} />
        )}
        {reasoningTokens !== undefined && reasoningTokens > 0 && (
          <UsageMetric label="Reasoning" value={formatCompactNumber(reasoningTokens)} />
        )}
      </div>
      {modelId && (
        <div className="mt-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800">
          <span className="font-mono text-[10.5px] text-zinc-400">{modelId}</span>
        </div>
      )}
    </section>
  );
}

function UsageMetric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 ${
        highlight
          ? "bg-[#fe591f]/10 text-[#fe591f]"
          : "bg-zinc-50 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-200"
      }`}
    >
      <div className="uppercase tracking-wide text-[9px] opacity-70">{label}</div>
      <div className="font-mono font-medium text-[13px] tabular-nums">{value}</div>
    </div>
  );
}

function DeployResultsCard({
  results,
}: {
  results: Array<{ templatePath: string; pushed: boolean; error?: string }>;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-4 py-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase mb-2">
        <Rocket className="h-3.5 w-3.5" />
        Deploy results
      </h3>
      <div className="space-y-1.5">
        {results.map((dr, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {dr.pushed ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
            )}
            <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300 truncate">
              {dr.templatePath}
            </span>
            {dr.error && (
              <span className="text-xs text-red-500 truncate ml-auto">
                {dr.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ChildrenJobsCard({ jobs }: { jobs: Job[] }) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-4 py-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 dark:text-zinc-400 uppercase mb-2">
        <GitBranch className="h-3.5 w-3.5" />
        Child jobs
      </h3>
      <div className="flex flex-col gap-1.5">
        {jobs.map((cj) => (
          <Link
            key={cj.id}
            href={`/factory/${cj.id}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 dark:border-zinc-800 p-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <StatusBadge status={cj.status} />
              <span className="truncate text-[12.5px] text-zinc-600 dark:text-zinc-300">
                {cj.task}
              </span>
            </div>
            <span className="text-[10.5px] text-zinc-400 whitespace-nowrap shrink-0">
              {formatTimestamp(cj.createdAt)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

