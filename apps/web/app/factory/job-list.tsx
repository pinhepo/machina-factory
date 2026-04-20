"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  ExternalLink,
  GitBranch,
  Clock,
  Rocket,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Pin,
  Copy,
  Github,
  GitFork,
  RotateCcw,
  Square,
  MoreHorizontal,
  Inbox,
  Folder,
  Sparkles,
} from "lucide-react";
import { StatusBadge } from "./components/status-badge";
import type { Job } from "./db";

type FilterStatus = "all" | "active" | "completed" | "failed";
type SortMode = "recent" | "oldest" | "duration";
type GroupMode = "day" | "status" | "repo" | "none";

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
  return `${hours}h ${minutes % 60}m`;
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

function groupJobs(
  jobs: Job[],
  mode: GroupMode,
): { label: string | null; jobs: Job[]; kind?: string }[] {
  if (mode === "none") return [{ label: null, jobs }];
  if (mode === "status") {
    const order = [
      "running",
      "queued",
      "provisioning",
      "verifying",
      "committing",
      "deploying",
      "completed",
      "failed",
      "cancelled",
    ];
    const map = new Map<string, Job[]>();
    jobs.forEach((j) => {
      if (!map.has(j.status)) map.set(j.status, []);
      map.get(j.status)!.push(j);
    });
    return order
      .filter((s) => map.has(s))
      .map((s) => ({ label: s, jobs: map.get(s)! }));
  }
  if (mode === "repo") {
    const map = new Map<string, Job[]>();
    jobs.forEach((j) => {
      const k = `${j.repoOwner}/${j.repoName}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(j);
    });
    return Array.from(map.entries()).map(([label, jobs]) => ({
      label,
      jobs,
      kind: "repo",
    }));
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const buckets: Record<string, Job[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Earlier: [],
  };
  jobs.forEach((j) => {
    const d = new Date(j.createdAt);
    if (d >= today) buckets["Today"].push(j);
    else if (d >= yesterday) buckets["Yesterday"].push(j);
    else if (d >= weekAgo) buckets["This week"].push(j);
    else buckets["Earlier"].push(j);
  });
  return Object.entries(buckets)
    .filter(([, a]) => a.length > 0)
    .map(([label, jobs]) => ({ label, jobs }));
}

export function JobList({ jobs }: { jobs: Job[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [group, setGroup] = useState<GroupMode>("day");

  const filtered = useMemo(() => {
    let out = jobs.filter(
      (j) => matchesFilter(j, filter) && matchesSearch(j, search),
    );
    if (sort === "recent")
      out = [...out].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    if (sort === "oldest")
      out = [...out].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    if (sort === "duration")
      out = [...out].sort((a, b) => {
        const da =
          new Date(a.completedAt ?? Date.now()).getTime() -
          new Date(a.startedAt ?? a.createdAt).getTime();
        const db =
          new Date(b.completedAt ?? Date.now()).getTime() -
          new Date(b.startedAt ?? b.createdAt).getTime();
        return db - da;
      });
    return out;
  }, [jobs, filter, search, sort]);

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

  const grouped = useMemo(() => groupJobs(filtered, group), [filtered, group]);

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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

        <div className="flex-1" />

        <div className="text-[11.5px] text-zinc-500 tabular-nums">
          {filtered.length} results
        </div>

        <DropdownSelect
          label="Group"
          value={group}
          onChange={(v) => setGroup(v as GroupMode)}
          options={[
            { value: "day", label: "Day" },
            { value: "status", label: "Status" },
            { value: "repo", label: "Repository" },
            { value: "none", label: "No grouping" },
          ]}
        />
        <DropdownSelect
          label="Sort"
          value={sort}
          onChange={(v) => setSort(v as SortMode)}
          options={[
            { value: "recent", label: "Most recent" },
            { value: "oldest", label: "Oldest first" },
            { value: "duration", label: "Longest running" },
          ]}
        />
      </div>

      {/* Empty */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-8 py-16 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-400">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="mt-3 text-[14px] font-medium text-zinc-900 dark:text-zinc-100">
            {search
              ? `No jobs match "${search}"`
              : filter !== "all"
                ? `No ${filter} jobs`
                : "No jobs yet"}
          </div>
          <div className="mt-1 text-[12.5px] text-zinc-500 max-w-sm mx-auto">
            {search
              ? "Try a different search term, repo, or branch name."
              : "Spin one up with ⌘N or the New Job button."}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((g, idx) => (
            <section key={idx}>
              {g.label && (
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  {g.kind === "repo" ? (
                    <span className="font-mono text-[11.5px] text-zinc-700 dark:text-zinc-300 font-medium">
                      {g.label}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      {g.label}
                    </span>
                  )}
                  <span className="text-[10.5px] text-zinc-400 tabular-nums">
                    {g.jobs.length}
                  </span>
                  <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                </div>
              )}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
                {g.jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DropdownSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-[12px] text-zinc-700 dark:text-zinc-300 hover:border-zinc-300"
      >
        <span className="text-zinc-400">{label}:</span>
        <span className="font-medium">{current?.label}</span>
        <ChevronDown className="h-3 w-3 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-48 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-1">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] flex items-center gap-2 ${
                o.value === value
                  ? "bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="flex-1">{o.label}</span>
              {o.value === value && (
                <Check className="h-3 w-3 text-[#fe591f]" />
              )}
            </button>
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
  const isFailed = job.status === "failed";
  const duration = formatDuration(job);
  const deployed = deployResults && deployResults.every((d) => d.pushed);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <Link
      href={`/factory/${job.id}`}
      className="group block border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 px-5 py-3.5 transition-all hover:bg-white dark:hover:bg-zinc-900"
    >
      <div className="flex items-start gap-4">
        {/* Status */}
        <div className="pt-[3px] w-[96px] shrink-0">
          <StatusBadge status={job.status} />
        </div>

        {/* Middle */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-zinc-500">
            <span className="font-mono truncate max-w-[260px]">
              {job.repoOwner}/
              <span className="text-zinc-700 dark:text-zinc-300">
                {job.repoName}
              </span>
            </span>
            <span className="text-zinc-300">·</span>
            <span className="font-mono truncate max-w-[200px] inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3 text-zinc-400" />
              {job.workBranch}
            </span>
            <span className="text-zinc-300">·</span>
            <span>{formatRelativeTime(job.createdAt)}</span>
            {duration && (
              <>
                <span className="text-zinc-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3 text-zinc-400" />
                  {duration}
                </span>
              </>
            )}
            {job.modelId && (
              <>
                <span className="text-zinc-300">·</span>
                <span className="font-mono text-zinc-400">{job.modelId}</span>
              </>
            )}
          </div>

          <p
            className="text-[13.5px] leading-[1.55] text-zinc-800 dark:text-zinc-200 overflow-hidden"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
            }}
          >
            {job.task}
          </p>

          {isActive && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 max-w-[240px] h-[3px] rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div className="h-full w-1/3 bg-amber-500 rounded-full animate-pulse" />
              </div>
              <span className="text-[10.5px] text-amber-700 dark:text-amber-400 font-medium">
                in progress
              </span>
            </div>
          )}

          {isFailed && job.error && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              <span className="truncate max-w-[420px]">{job.error}</span>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="shrink-0 flex items-center gap-1.5 pt-[2px]">
          {deployed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-900 px-2 py-[2px] text-[10.5px] font-medium">
              <Rocket className="h-3 w-3" /> deployed
            </span>
          )}
          {prNumber != null && prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-900 hover:bg-blue-100 px-2 py-[2px] text-[10.5px] font-medium"
            >
              PR #{prNumber} <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            {isFailed && (
              <RowAction title="Retry" onClick={() => {}}>
                <RotateCcw className="h-3.5 w-3.5" />
              </RowAction>
            )}
            {isActive && (
              <RowAction title="Cancel" onClick={() => {}}>
                <Square className="h-3 w-3" />
              </RowAction>
            )}
            <RowAction title="Continue / branch" onClick={() => {}}>
              <GitFork className="h-3.5 w-3.5" />
            </RowAction>
            <RowAction
              title="Copy job ID"
              onClick={() => navigator.clipboard?.writeText(job.id)}
            >
              <Copy className="h-3 w-3" />
            </RowAction>
            <RowAction title="Pin" onClick={() => {}}>
              <Pin className="h-3 w-3" />
            </RowAction>
            {prUrl && (
              <RowAction title="Open PR" onClick={() => {}}>
                <Github className="h-3 w-3" />
              </RowAction>
            )}
            <div ref={menuRef} className="relative">
              <RowAction
                title="More"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen((o) => !o);
                }}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </RowAction>
              {menuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+4px)] z-30 w-48 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-1"
                  onClick={(e) => e.preventDefault()}
                >
                  <MenuItem icon={ExternalLink}>Open job detail</MenuItem>
                  <MenuItem icon={GitFork}>Continue / branch</MenuItem>
                  <MenuItem icon={Copy}>Copy job ID</MenuItem>
                  <MenuItem icon={Pin}>Pin</MenuItem>
                  {isFailed && <MenuItem icon={RotateCcw}>Retry job</MenuItem>}
                  {isActive && <MenuItem icon={Square}>Cancel run</MenuItem>}
                  {prUrl && <MenuItem icon={Github}>Open PR</MenuItem>}
                </div>
              )}
            </div>
          </div>

          {isFailed && !job.error && (
            <AlertTriangle className="h-4 w-4 text-red-400" />
          )}
          <ChevronRight className="h-4 w-4 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 transition-colors" />
        </div>
      </div>
    </Link>
  );
}

function RowAction({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
    >
      {children}
    </button>
  );
}

function MenuItem({
  children,
  icon: I,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
      <I className="h-3 w-3 text-zinc-400" />
      <span className="flex-1">{children}</span>
    </button>
  );
}

