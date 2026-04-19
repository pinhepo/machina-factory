import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Plus,
  Home,
  Activity,
  Sparkles,
  Folder,
  Key,
  Users,
  BookOpen,
  Settings,
} from "lucide-react";
import { isAuthenticated } from "./auth";
import { getJobs } from "./db";
import { JobListPoller } from "./job-list-poller";
import { JobList } from "./job-list";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set([
  "queued",
  "provisioning",
  "running",
  "verifying",
  "committing",
  "deploying",
]);

function formatDurationShort(startISO: string | null, endISO: string | null) {
  if (!startISO) return "—";
  const start = new Date(startISO).getTime();
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  const s = Math.floor((end - start) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default async function FactoryPage() {
  if (!(await isAuthenticated())) {
    redirect("/factory/login");
  }

  const jobs = await getJobs();

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;
  const queued = jobs.filter((j) => j.status === "queued").length;
  const failed = jobs.filter(
    (j) => j.status === "failed" || j.status === "cancelled",
  ).length;
  const hasActiveJobs = running > 0;

  const successRate =
    total > 0 ? Math.round((completed / Math.max(total, 1)) * 100) : 0;

  // avg duration across terminal jobs with start+end
  const durations = jobs
    .map((j) => {
      if (!j.startedAt || !j.completedAt) return null;
      return (
        new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()
      );
    })
    .filter((v): v is number => v != null);
  const avgMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const avgDur =
    avgMs === 0
      ? "—"
      : formatDurationShort(
          new Date().toISOString(),
          new Date(Date.now() + avgMs).toISOString(),
        );

  // repo counts (for sidebar)
  const repoCountsMap = new Map<string, number>();
  for (const j of jobs) {
    const k = `${j.repoOwner}/${j.repoName}`;
    repoCountsMap.set(k, (repoCountsMap.get(k) ?? 0) + 1);
  }
  const repoCounts = Array.from(repoCountsMap.entries())
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count);

  const navItems = [
    { id: "jobs", label: "Jobs", href: "/factory", icon: Home, badge: total, active: true },
    { id: "runs", label: "Active runs", href: "/factory", icon: Activity, badge: running, live: running > 0 },
    { id: "templates", label: "Templates", href: "/factory", icon: Sparkles },
    { id: "repos", label: "Repositories", href: "/factory", icon: Folder },
    { id: "secrets", label: "Secrets", href: "/factory/settings", icon: Key },
    { id: "team", label: "Team", href: "/factory/settings", icon: Users },
    { id: "docs", label: "Docs", href: "#", icon: BookOpen },
  ];

  return (
    <div className="flex gap-6">
      <JobListPoller hasActiveJobs={hasActiveJobs} />

      {/* Sidebar */}
      <aside className="w-60 shrink-0 sticky top-20 self-start hidden lg:flex flex-col gap-4">
        <Link
          href="/factory/new"
          className="group w-full inline-flex items-center gap-2 rounded-lg bg-[#fe591f] px-3 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#fe591f]/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New Job
          <span className="ml-auto text-[10px] font-mono text-white/70 border border-white/30 rounded px-1 py-[1px]">
            ⌘ N
          </span>
        </Link>

        <nav className="space-y-[2px]">
          {navItems.map((item) => {
            const I = item.icon;
            const isActive = item.active;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] ${
                  isActive
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <I
                  className={`h-4 w-4 ${isActive ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 group-hover:text-zinc-600"}`}
                />
                <span className="flex-1">{item.label}</span>
                {item.live && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
                {item.badge != null && (
                  <span
                    className={`text-[10px] tabular-nums ${
                      isActive ? "text-zinc-500" : "text-zinc-400"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {repoCounts.length > 0 && (
          <div>
            <div className="px-2.5 pb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                Repositories
              </span>
            </div>
            <div className="space-y-[2px]">
              {repoCounts.slice(0, 8).map(({ repo, count }) => (
                <div
                  key={repo}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="h-1.5 w-1.5 rounded-sm bg-zinc-300 shrink-0" />
                  <span className="flex-1 truncate font-mono text-[11.5px]">
                    {repo.split("/")[1]}
                  </span>
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Jobs
            </h1>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              {total} total
              {running > 0 && (
                <>
                  {" "}
                  &middot;{" "}
                  <span className="text-yellow-500">{running} running</span>
                </>
              )}
              {completed > 0 && (
                <>
                  {" "}
                  &middot;{" "}
                  <span className="text-emerald-500">{completed} completed</span>
                </>
              )}
              {failed > 0 && (
                <>
                  {" "}
                  &middot; <span className="text-red-500">{failed} failed</span>
                </>
              )}
            </p>
          </div>
          <Link
            href="/factory/new"
            className="lg:hidden inline-flex items-center gap-2 rounded-lg bg-[#fe591f] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#fe591f]/90"
          >
            <Plus className="h-4 w-4" />
            New Job
          </Link>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <StatTile label="Total jobs" value={total} sub="last 30 days" />
          <StatTile
            label="Running"
            value={running}
            live={running > 0}
            sub={running > 0 ? `${queued} queued` : "nothing in flight"}
          />
          <StatTile
            label="Success rate"
            value={`${successRate}%`}
            sub={`${completed} completed`}
            progress={successRate}
          />
          <StatTile label="Avg duration" value={avgDur} sub={`across ${durations.length} runs`} />
        </div>

        {/* Job list */}
        <JobList jobs={jobs} />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  live,
  progress,
}: {
  label: string;
  value: string | number;
  sub: string;
  live?: boolean;
  progress?: number;
}) {
  return (
    <div className="bg-white dark:bg-zinc-950 px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
          {label}
        </div>
        {live && (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-[22px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 leading-none">
          {value}
        </div>
        {progress != null && (
          <div className="flex-1 ml-2 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}

