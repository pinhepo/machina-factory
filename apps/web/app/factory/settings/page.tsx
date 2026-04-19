import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { getProject } from "../db";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAuthenticated())) {
    redirect("/factory/login");
  }

  const project = await getProject();

  if (!project) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-6 py-12 text-center text-zinc-500">
          No project found. Create a project first via the API.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {project.machinaOrgId} / {project.machinaProjectId}
        </p>
      </div>
      <SettingsForm projectId={project.id} settings={project.settings ?? {}} />
    </div>
  );
}
