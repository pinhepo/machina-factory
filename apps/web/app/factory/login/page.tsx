import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { handleLogin } from "./actions";

export const metadata = { title: "Login" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAuthenticated()) {
    redirect("/factory");
  }

  const params = await searchParams;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#fe591f]/10 border border-[#fe591f]/20 mb-4">
            <img src="/Logo_3.svg" alt="Machina" width={28} height={28} />
          </div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Machina Factory
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Enter password to access the dashboard
          </p>
        </div>

        <form action={handleLogin} className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoFocus
            required
            className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#fe591f]/50 focus:ring-1 focus:ring-[#fe591f]/25"
          />

          {params.error && (
            <p className="text-sm text-red-400">Invalid password</p>
          )}

          <button
            type="submit"
            className="w-full py-2.5 bg-[#fe591f] hover:bg-[#fe591f]/90 text-white font-medium rounded-lg transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
