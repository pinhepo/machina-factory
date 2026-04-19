"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function JobListPoller({ hasActiveJobs }: { hasActiveJobs: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [hasActiveJobs, router]);

  return null;
}
