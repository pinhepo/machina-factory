import type { Sandbox, SandboxHooks } from "./interface";
import type { SandboxStatus } from "./types";
import { connectDocker } from "./docker/connect";
import type { DockerState } from "./docker/state";
import { connectVercel } from "./vercel/connect";
import type { VercelState } from "./vercel/state";

// Re-export SandboxStatus from types for convenience
export type { SandboxStatus };

/**
 * Local sandbox state — holds a reference to the actual sandbox instance.
 * Used to bypass connectSandbox for LocalSandbox (no Docker/Vercel reconnect).
 */
export interface LocalState {
  instance: Sandbox;
}

/**
 * Unified sandbox state type.
 * Use `type` discriminator to determine which sandbox implementation to use.
 */
export type SandboxState =
  | ({ type: "vercel" } & VercelState)
  | ({ type: "docker" } & DockerState)
  | ({ type: "local" } & LocalState);

/**
 * Base connect options for all sandbox types.
 */
export interface ConnectOptions {
  /** Environment variables available to sandbox commands */
  env?: Record<string, string>;
  /** GitHub token used for credential brokering; never exposed inside the sandbox */
  githubToken?: string;
  /** Git user for commits */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
  /** Timeout in milliseconds for sandboxes (default: 300,000 = 5 minutes) */
  timeout?: number;
  /** Ports to expose from the sandbox for dev server preview URLs */
  ports?: number[];
  /** Snapshot ID used as the base image for new sandboxes */
  baseSnapshotId?: string;
  /** Whether to resume a stopped persistent sandbox session */
  resume?: boolean;
  /** Whether to create the named sandbox when it does not already exist */
  createIfMissing?: boolean;
  /** Whether new sandboxes should persist filesystem state between sessions */
  persistent?: boolean;
  /** Default expiration for automatic persistent-sandbox snapshots */
  snapshotExpiration?: number;
  /**
   * Skip git init in an empty workspace (e.g. when refreshing a Vercel base snapshot).
   */
  skipGitWorkspaceBootstrap?: boolean;
  /** Docker image to use for sandbox containers */
  image?: string;
}

/**
 * Configuration for connecting to a sandbox.
 */
export type SandboxConnectConfig =
  | {
      state: { type: "vercel" } & VercelState;
      options?: ConnectOptions;
    }
  | {
      state: { type: "docker" } & DockerState;
      options?: ConnectOptions;
    }
  | {
      state: { type: "local" } & LocalState;
      options?: ConnectOptions;
    };

/**
 * Connect to a sandbox based on the provided configuration.
 */
export async function connectSandbox(
  configOrState: SandboxConnectConfig | SandboxState,
  legacyOptions?: ConnectOptions,
): Promise<Sandbox> {
  const isNewApi =
    typeof configOrState === "object" &&
    "state" in configOrState &&
    typeof configOrState.state === "object" &&
    "type" in configOrState.state;

  if (isNewApi) {
    const config = configOrState as SandboxConnectConfig;
    if (config.state.type === "local") {
      return (config.state as { type: "local" } & LocalState).instance;
    }
    if (config.state.type === "docker") {
      return connectDocker(config.state, config.options);
    }
    return connectVercel(config.state, config.options);
  }

  const state = configOrState as SandboxState;
  if (state.type === "local") {
    return state.instance;
  }
  if (state.type === "docker") {
    return connectDocker(state, legacyOptions);
  }
  return connectVercel(state, legacyOptions);
}
