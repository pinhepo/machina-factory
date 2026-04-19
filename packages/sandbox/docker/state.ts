import type { Source } from "../types";

/**
 * State configuration for Docker-based sandbox containers.
 * Used with the unified `connectSandbox()` API.
 */
export interface DockerState {
  /** Where to clone from (omit for empty sandbox or when reconnecting) */
  source?: Source;
  /** Docker container ID for reconnecting to existing containers */
  containerId?: string;
  /** Docker container name for identification */
  containerName?: string;
  /** Host path where the workspace volume is mounted */
  volumePath?: string;
  /** Timestamp (ms) when the container will be stopped */
  expiresAt?: number;
}
