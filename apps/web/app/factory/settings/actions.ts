"use server";

import type { DeployConfig } from "../db";
import { updateProjectSettings as dbUpdate } from "../db";

export interface SettingsState {
  error?: string;
  success?: boolean;
}

export async function updateProjectSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const projectId = formData.get("projectId") as string;

  if (!projectId) {
    return { error: "Project ID is missing" };
  }

  const deploy: DeployConfig = {
    machinaApiKey: (formData.get("machinaApiKey") as string) || undefined,
    clientApiUrl: (formData.get("clientApiUrl") as string) || undefined,
    coreApiUrl: (formData.get("coreApiUrl") as string) || undefined,
    autoPushTemplates: formData.get("autoPushTemplates") === "on",
    autoRedeploy: formData.get("autoRedeploy") === "on",
  };

  try {
    await dbUpdate(projectId, { deploy });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Failed to save: ${message}` };
  }
}

export interface TestConnectionState {
  status?: "idle" | "testing" | "success" | "error";
  error?: string;
  httpStatus?: number;
}

export async function testConnection(
  _prev: TestConnectionState,
  formData: FormData,
): Promise<TestConnectionState> {
  const clientApiUrl = formData.get("clientApiUrl") as string;
  const machinaApiKey = formData.get("machinaApiKey") as string;

  if (!clientApiUrl || !machinaApiKey) {
    return {
      status: "error",
      error: "Client API URL and API key are required",
    };
  }

  try {
    // Test by listing agents on the client-api
    const res = await fetch(`${clientApiUrl.replace(/\/$/, "")}/agent/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Token": machinaApiKey,
      },
      body: JSON.stringify({ filters: {}, page: 1, page_size: 1 }),
    });

    if (!res.ok) {
      return {
        status: "error",
        error: `Client API returned ${res.status}`,
        httpStatus: res.status,
      };
    }

    return { status: "success", httpStatus: res.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", error: `Connection failed: ${message}` };
  }
}
