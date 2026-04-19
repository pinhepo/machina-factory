import type { Sandbox, SandboxHooks } from "../interface";
import type { DockerSandboxConfig, DockerSandboxConnectConfig } from "./config";
import { DockerSandbox } from "./sandbox";
import type { DockerState } from "./state";

interface ConnectOptions {
  env?: Record<string, string>;
  githubToken?: string;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  resume?: boolean;
  image?: string;
}

function getRemainingTimeout(
  expiresAt: number | undefined,
): number | undefined {
  if (!expiresAt) return undefined;
  const remaining = expiresAt - Date.now();
  return remaining > 10_000 ? remaining : undefined;
}

function buildCreateConfig(
  state: DockerState,
  options?: ConnectOptions,
): DockerSandboxConfig {
  return {
    ...(state.containerName ? { name: state.containerName } : {}),
    ...(state.source ? { source: state.source } : {}),
    env: options?.env,
    githubToken: options?.githubToken,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.image && { image: options.image }),
  };
}

/**
 * Connect to a Docker sandbox based on the provided state.
 *
 * - If `containerId` or `containerName` is present, reconnects to the container
 * - If `source` is present, creates a new container and clones the repo
 * - Otherwise, creates an empty container
 */
export async function connectDocker(
  state: DockerState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const containerRef = state.containerId ?? state.containerName;

  if (containerRef) {
    try {
      const remainingTimeout = getRemainingTimeout(state.expiresAt);
      const connectConfig: DockerSandboxConnectConfig = {
        env: options?.env,
        githubToken: options?.githubToken,
        hooks: options?.hooks,
        remainingTimeout,
      };

      return await DockerSandbox.connect(containerRef, connectConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("No such container") && !message.includes("404")) {
        throw error;
      }
      // Container not found -- fall through to create
    }
  }

  return DockerSandbox.create(buildCreateConfig(state, options));
}
