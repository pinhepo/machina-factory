export const STATUS_STYLES: Record<string, string> = {
  queued: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  provisioning:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  running:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/60 dark:text-yellow-300",
  verifying:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300",
  committing:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  deploying:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300",
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
  cancelled: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-zinc-700 text-zinc-400";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {status}
    </span>
  );
}
