"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  ExternalLink,
  GitBranch,
  Clock,
  Rocket,
  AlertTriangle,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { StatusBadge } from "./components/status-badge";
import type { Job } from "./db";

type FilterStatus = "all" | "active" | "completed" | "failed";

const FILTER_TABS: { key: FilterStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
];

const ACTIVE_STATUSES = new Set([
  "queued",
  "provisioning",
  "running",
  "verifying",
  "committing",
  "deploying",
]);

function matchesFilter(job: Job, filter: FilterStatus): boolean {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE_STATUSES.has(job.status);
  if (filter === "completed") return job.status === "completed";
  if (filter === "failed")
    return job.status === "failed" || job.status === "cancelled";
  return true;
}

function matchesSearch(job: Job, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    job.task.toLowerCase().includes(q) ||
    `${job.repoOwner}/${job.repoName}`.toLowerCase().includes(q) ||
    job.workBranch.toLowerCase().includes(q) ||
    job.status.toLowerCase().includes(q)
  );
}

function formatDuration(job: Job): string {
  const start = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const end = job.completedAt
    ? new Date(job.completedAt).getTime()
    : start
      ? Date.now()
      : null;
  if (!start || !end) return "";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function JobList({ jobs }: { jobs: Job[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");

  const filtered = useMemo(
    () =>
      jobs.filter(
        (job) => matchesFilter(job, filter) && matchesSearch(job, search),
      ),
    [jobs, filter, search],
  );

  const filterCounts = useMemo(
    () => ({
      all: jobs.length,
      active: jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter(
        (j) => j.status === "failed" || j.status === "cancelled",
      ).length,
    }),
    [jobs],
  );

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search jobs by task, repo, branch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 transition-colors focus:border-[#fe591f] focus:outline-none focus:ring-1 focus:ring-[#fe591f]"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-1">
          {FILTER_TABS.map((tab) => {
            const count = filterCounts[tab.key];
            const isActive = filter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={`ml-1.5 ${isActive ? "text-zinc-500" : "text-zinc-400"}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Job Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-6 py-12 text-center text-zinc-500">
          {search
            ? `No jobs matching "${search}"`
            : filter !== "all"
              ? `No ${filter} jobs`
              : "No jobs yet. Create one to get started."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const result = job.result as Record<string, unknown> | null;
  const prUrl = result?.prUrl as string | undefined;
  const prNumber = result?.prNumber as number | undefined;
  const deployResults = result?.deployResults as
    | Array<{ templatePath: string; pushed: boolean }>
    | undefined;
  const isActive = ACTIVE_STATUSES.has(job.status);
  const duration = formatDuration(job);

  return (
    <Link
      href={`/factory/${job.id}`}
      className="group block rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-4 py-3.5 transition-all hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Status + Task */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Top row: status + repo */}
          <div className="flex items-center gap-2.5">
            <StatusBadge status={job.status} />
            {isActive && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-400" />
            )}
            <span className="font-mono text-xs text-zinc-400 truncate">
              {job.repoOwner}/{job.repoName}
            </span>
          </div>

          {/* Task description */}
          <p className="text-sm text-zinc-800 dark:text-zinc-200 line-clamp-2 group-hover:text-zinc-900 dark:group-hover:text-white">
            {job.task}
          </p>

          {/* Bottom row: metadata */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {job.workBranch}
            </span>
            {duration && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {duration}
              </span>
            )}
            <span>{formatRelativeTime(job.createdAt)}</span>
            {job.modelId && (
              <span className="text-zinc-400">{job.modelId}</span>
            )}
          </div>
        </div>

        {/* Right: PR + Deploy + Arrow */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Deploy badge */}
          {deployResults && deployResults.length > 0 && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                deployResults.every((d) => d.pushed)
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
              }`}
            >
              <Rocket className="h-3 w-3" />
              {deployResults.every((d) => d.pushed)
                ? "Deployed"
                : "Deploy failed"}
            </span>
          )}

          {/* PR link */}
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
            >
              PR #{prNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {/* Error indicator */}
          {job.status === "failed" && job.error && (
            <AlertTriangle className="h-4 w-4 text-red-400" />
          )}

          <ChevronRight className="h-4 w-4 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 transition-colors" />
        </div>
      </div>
    </Link>
  );
}
