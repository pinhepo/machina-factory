import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";

interface GitHubAppConfig {
  appId: number;
  privateKey: string;
}

function parsePrivateKey(value: string): string {
  const unescaped = value.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("BEGIN") && unescaped.includes("PRIVATE KEY")) {
    return unescaped;
  }

  const decoded = Buffer.from(value, "base64").toString("utf-8").trim();
  if (decoded.includes("BEGIN") && decoded.includes("PRIVATE KEY")) {
    return decoded;
  }

  throw new Error("Invalid GITHUB_APP_PRIVATE_KEY format");
}

function loadPrivateKey(): string {
  // Try inline env var first
  const inlineKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inlineKey) {
    return parsePrivateKey(inlineKey);
  }

  // Try file path
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (keyPath) {
    const resolved = path.isAbsolute(keyPath)
      ? keyPath
      : path.resolve(process.cwd(), keyPath);
    return fs.readFileSync(resolved, "utf-8").trim();
  }

  throw new Error(
    "GitHub App private key not configured. Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH",
  );
}

function getGitHubAppConfig(): GitHubAppConfig {
  const appIdRaw = process.env.GITHUB_APP_ID;
  if (!appIdRaw) {
    throw new Error("GitHub App is not configured (GITHUB_APP_ID missing)");
  }

  const appId = Number.parseInt(appIdRaw, 10);
  if (!Number.isFinite(appId)) {
    throw new Error("Invalid GITHUB_APP_ID");
  }

  const privateKey = loadPrivateKey();
  return { appId, privateKey };
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
    (process.env.GITHUB_APP_PRIVATE_KEY ||
      process.env.GITHUB_APP_PRIVATE_KEY_PATH),
  );
}

/**
 * Get an installation token for a specific GitHub App installation.
 */
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const { appId, privateKey } = getGitHubAppConfig();

  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const authResult = await auth({ type: "installation", installationId });
  return authResult.token;
}

/**
 * Get an Octokit instance authenticated as a specific installation.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  const { appId, privateKey } = getGitHubAppConfig();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });
}

/**
 * Get an Octokit instance authenticated as the GitHub App itself.
 */
export function getAppOctokit(): Octokit {
  const { appId, privateKey } = getGitHubAppConfig();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });
}

/**
 * Find the installation ID for a given repository owner.
 * Searches all installations of the GitHub App.
 */
export async function findInstallationForOwner(
  owner: string,
): Promise<number | null> {
  const octokit = getAppOctokit();

  try {
    const { data: installations } = await octokit.apps.listInstallations();

    const installation = installations.find(
      (i) => i.account?.login?.toLowerCase() === owner.toLowerCase(),
    );

    return installation?.id ?? null;
  } catch {
    return null;
  }
}
