"use client";

import { useActionState, useState } from "react";
import {
  Save,
  Eye,
  EyeOff,
  Plug,
  Loader2,
  CheckCircle2,
  XCircle,
  Rocket,
  Key,
} from "lucide-react";
import type { ProjectSettings } from "../db";
import {
  updateProjectSettings,
  testConnection,
  type SettingsState,
  type TestConnectionState,
} from "./actions";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-[#fe591f] focus:outline-none focus:ring-1 focus:ring-[#fe591f]";

const labelClass =
  "mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300";

const helpClass = "mt-1 text-xs text-zinc-400 dark:text-zinc-500";

const sectionClass =
  "rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-5 space-y-4";

const initialSettingsState: SettingsState = {};
const initialTestState: TestConnectionState = { status: "idle" };

export function SettingsForm({
  projectId,
  settings,
}: {
  projectId: string;
  settings: ProjectSettings;
}) {
  const deploy = settings.deploy ?? {};

  const [settingsState, settingsAction, settingsPending] = useActionState(
    updateProjectSettings,
    initialSettingsState,
  );

  const [testState, testAction, testPending] = useActionState(
    testConnection,
    initialTestState,
  );

  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(deploy.machinaApiKey ?? "");
  const [clientApiUrlValue, setClientApiUrlValue] = useState(
    deploy.clientApiUrl ?? "",
  );

  return (
    <div className="space-y-8">
      {/* Deploy Pipeline Settings */}
      <form action={settingsAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <div className="space-y-6">
          <div className={sectionClass}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Rocket className="h-4 w-4 text-[#fe591f]" />
              Deploy Pipeline
            </h2>
            <p className="text-xs text-zinc-500">
              Configure how templates are deployed to the Machina platform after
              a job completes.
            </p>

            {/* Client API URL */}
            <div>
              <label htmlFor="clientApiUrl" className={labelClass}>
                Client API URL
              </label>
              <input
                id="clientApiUrl"
                name="clientApiUrl"
                type="url"
                placeholder="https://org-project.org.machina.gg"
                value={clientApiUrlValue}
                onChange={(e) => setClientApiUrlValue(e.target.value)}
                className={inputClass}
              />
              <p className={helpClass}>
                The client-api endpoint for your Machina project. Used for
                template upload and machina-cli direct auth.
              </p>
            </div>

            {/* Core API URL */}
            <div>
              <label htmlFor="coreApiUrl" className={labelClass}>
                Core API URL
              </label>
              <input
                id="coreApiUrl"
                name="coreApiUrl"
                type="url"
                placeholder="https://api.machina.gg"
                defaultValue={deploy.coreApiUrl ?? ""}
                className={inputClass}
              />
              <p className={helpClass}>
                Optional. Defaults to https://api.machina.gg. Only change for
                custom deployments.
              </p>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ToggleField
                id="autoPushTemplates"
                name="autoPushTemplates"
                label="Auto-push templates"
                description="Automatically push discovered templates after job completion"
                defaultChecked={deploy.autoPushTemplates ?? false}
              />
              <ToggleField
                id="autoRedeploy"
                name="autoRedeploy"
                label="Auto-redeploy"
                description="Trigger a client-api redeploy after templates are pushed"
                defaultChecked={deploy.autoRedeploy ?? false}
              />
            </div>
          </div>

          {/* machina-cli Auth */}
          <div className={sectionClass}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Key className="h-4 w-4 text-[#fe591f]" />
              machina-cli Authentication
            </h2>
            <p className="text-xs text-zinc-500">
              API key for authenticating machina-cli against the client-api.
              Uses direct API key auth (X-Api-Token header) — no browser login
              required.
            </p>

            {/* Auth mode info */}
            <div className="rounded-md bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Direct API Key Auth
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                When configured, machina-cli authenticates directly with the
                client-api using the API key below. This bypasses the core-api
                project token flow and works in CI/CD, Factory sandbox, and
                headless environments.
              </p>
            </div>

            {/* API Key */}
            <div>
              <label htmlFor="machinaApiKey" className={labelClass}>
                API Key
              </label>
              <div className="relative">
                <input
                  id="machinaApiKey"
                  name="machinaApiKey"
                  type={showApiKey ? "text" : "password"}
                  placeholder="Enter your Machina API key"
                  value={apiKeyValue}
                  onChange={(e) => setApiKeyValue(e.target.value)}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className={helpClass}>
                The X-Api-Token used by machina-cli for client-api
                authentication. Stored securely in project settings.
              </p>
            </div>
          </div>

          {/* Status messages */}
          {settingsState.error && (
            <div className="rounded-lg border border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-600 dark:text-red-300">
              {settingsState.error}
            </div>
          )}
          {settingsState.success && (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Settings saved successfully
            </div>
          )}

          {/* Save button */}
          <button
            type="submit"
            disabled={settingsPending}
            className="inline-flex items-center gap-2 rounded-lg bg-[#fe591f] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#fe591f]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {settingsPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
          </button>
        </div>
      </form>

      {/* Connection Test — separate form */}
      <div className={sectionClass}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Plug className="h-4 w-4 text-[#fe591f]" />
          Connection Test
        </h2>
        <p className="text-xs text-zinc-500">
          Verify that the API key and client-api URL are working. This will
          attempt to list resources via the client-api.
        </p>

        <form action={testAction} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="clientApiUrl" value={clientApiUrlValue} />
          <input type="hidden" name="machinaApiKey" value={apiKeyValue} />

          {testState.status === "success" && (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Connection successful
              {testState.httpStatus && (
                <span className="text-xs opacity-75">
                  (HTTP {testState.httpStatus})
                </span>
              )}
            </div>
          )}

          {testState.status === "error" && (
            <div className="rounded-lg border border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-600 dark:text-red-300 flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {testState.error}
              {testState.httpStatus && (
                <span className="text-xs opacity-75">
                  (HTTP {testState.httpStatus})
                </span>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={testPending || !clientApiUrlValue || !apiKeyValue}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            Test Connection
          </button>
        </form>
      </div>
    </div>
  );
}

function ToggleField({
  id,
  name,
  label,
  description,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 px-3 py-3 cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
    >
      <input
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-[#fe591f] focus:ring-[#fe591f] accent-[#fe591f]"
      />
      <div>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </span>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
    </label>
  );
}
