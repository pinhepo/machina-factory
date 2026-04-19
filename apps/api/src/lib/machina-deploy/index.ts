import type { Sandbox } from "@machina-factory/sandbox";
import type { DeployConfig, DeployResult } from "../db/schema";
import type { JobLogger } from "../jobs/logger";
import { discoverTemplates } from "./discover-templates";
import { pushTemplate } from "./push-template";

/**
 * Discover MODIFIED templates and push them to the Machina platform.
 * Only templates with files changed by the agent are deployed (not all templates in the repo).
 */
export async function deployTemplates(
  sandbox: Sandbox,
  config: DeployConfig,
  log: JobLogger,
  baseBranch?: string,
): Promise<DeployResult[]> {
  const templates = await discoverTemplates(sandbox, baseBranch);

  if (templates.length === 0) {
    await log.info("No templates found (no _install.yml files in workspace)");
    return [];
  }

  await log.info(
    `Found ${templates.length} template(s) to deploy: ${templates.map((t) => t.relativePath).join(", ")}`,
  );

  const results: DeployResult[] = [];

  for (const template of templates) {
    const result = await pushTemplate(
      template.dirPath,
      template.relativePath,
      config,
      log,
    );
    results.push(result);

    if (!result.pushed) {
      await log.warn(
        `Failed to push template ${template.relativePath}: ${result.error}`,
      );
    }
  }

  const pushed = results.filter((r) => r.pushed).length;
  const failed = results.length - pushed;
  await log.info(`Deploy complete: ${pushed} pushed, ${failed} failed`);

  return results;
}

/**
 * Trigger a client-api redeploy via the Machina core-api.
 * POST /organization/{orgId}/deploy-client-api
 */
export async function triggerRedeploy(
  config: DeployConfig,
  organizationId: string,
  log: JobLogger,
): Promise<boolean> {
  const coreApiUrl = config.coreApiUrl ?? "https://api.machina.gg";
  const { machinaApiKey } = config;

  if (!machinaApiKey) {
    await log.warn("Cannot trigger redeploy: missing machinaApiKey");
    return false;
  }

  try {
    const url = `${coreApiUrl.replace(/\/$/, "")}/organization/${organizationId}/deploy-client-api`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Token": machinaApiKey,
      },
      body: JSON.stringify({ client_api_version: "beta" }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      await log.warn(
        `Redeploy trigger failed (${response.status}): ${body.slice(0, 300)}`,
      );
      return false;
    }

    await log.info("Client-api redeploy triggered");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log.warn(`Redeploy trigger error: ${message}`);
    return false;
  }
}
