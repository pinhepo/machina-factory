"use client";

import type { ReactNode } from "react";
import { Sparkles, User } from "lucide-react";

type From = "user" | "assistant";

interface Props {
  from: From;
  title?: string;
  children: ReactNode;
}

export function MessageCard({ from, title, children }: Props) {
  const accent =
    from === "assistant"
      ? "border-l-4 border-l-[#fe591f]"
      : "border-l-4 border-l-zinc-400 dark:border-l-zinc-600";
  const Icon = from === "assistant" ? Sparkles : User;
  const iconClass =
    from === "assistant"
      ? "text-[#fe591f]"
      : "text-zinc-500 dark:text-zinc-400";

  return (
    <section
      className={`rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6 ${accent}`}
    >
      {title && (
        <header className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <Icon className={`h-4 w-4 ${iconClass}`} />
          <span>{title}</span>
        </header>
      )}
      {children}
    </section>
  );
}
