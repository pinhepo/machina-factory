import type { SandboxHooks } from "../interface";
import type { Source } from "../types";

/**
 * Configuration for creating a new Docker sandbox container.
 */
export interface DockerSandboxConfig {
  /** Container name for identification and reconnection */
  name?: string;
  /** Git repository to clone into the workspace */
  source?: Source;
  /** Environment variables to inject into the container */
  env?: Record<string, string>;
  /** GitHub token for git operations inside the container */
  githubToken?: string;
  /** Git user for commits */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
  /** Timeout in milliseconds (default: 1,800,000 = 30 minutes) */
  timeout?: number;
  /** Docker image to use (default: from SANDBOX_BASE_IMAGE env) */
  image?: string;
}

/**
 * Configuration for reconnecting to an existing Docker container.
 */
export interface DockerSandboxConnectConfig {
  /** Environment variables available to sandbox commands */
  env?: Record<string, string>;
  /** GitHub token for git operations */
  githubToken?: string;
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
  /** Remaining timeout in ms from a previous session */
  remainingTimeout?: number;
}

/**
 * Default configuration values for Docker sandboxes.
 */
export const DOCKER_DEFAULTS = {
  /** Working directory inside the container */
  workingDirectory: "/workspace",
  /** Default timeout: 30 minutes */
  timeout: 1_800_000,
  /** Max output length for exec commands (matches Vercel sandbox) */
  maxOutputLength: 50_000,
  /** Buffer before timeout for cleanup */
  timeoutBuffer: 30_000,
  /** Quick failure window for detached commands */
  detachedQuickFailureWindow: 2_000,
  /** Default image */
  defaultImage: "machina-factory/sandbox-base:latest",
} as const;
