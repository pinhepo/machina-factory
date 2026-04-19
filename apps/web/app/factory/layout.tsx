import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { isAuthRequired, logout } from "./auth";
import { ThemeToggle } from "./components/theme-toggle";

export const metadata: Metadata = {
  title: "Machina Factory",
  description: "Coding agent runtime dashboard",
};

export default async function FactoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Skip auth check for login page (handled by checking pathname won't work in layout,
  // so login page has its own auth check)

  async function handleLogout() {
    "use server";
    await logout();
    redirect("/factory/login");
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/factory" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fe591f]/10 border border-[#fe591f]/20">
              <img src="/Logo_3.svg" alt="Machina" width={20} height={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">
              Machina Factory
            </h1>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/factory/settings"
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <ThemeToggle />
            {isAuthRequired() && (
              <form action={handleLogout}>
                <button
                  type="submit"
                  className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
