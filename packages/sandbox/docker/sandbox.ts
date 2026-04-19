import Dockerode from "dockerode";
import type { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SnapshotResult,
} from "../interface";
import {
  DOCKER_DEFAULTS,
  type DockerSandboxConfig,
  type DockerSandboxConnectConfig,
} from "./config";
import type { DockerState } from "./state";

const docker = new Dockerode({
  socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
});

/**
 * Docker-based sandbox implementation.
 * Runs code in isolated Docker containers with volume-mounted workspaces.
 */
export class DockerSandbox implements Sandbox {
  readonly type = "docker" as const;
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly currentBranch?: string;
  readonly hooks?: SandboxHooks;

  /** Docker container ID */
  readonly containerId: string;
  /** Docker container name */
  readonly containerName: string;
  /** Host path where the workspace volume is mounted */
  readonly volumePath: string;

  private container: Dockerode.Container;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  private isStopped = false;
  private _expiresAt?: number;
  private _timeout?: number;

  get expiresAt(): number | undefined {
    return this._expiresAt;
  }

  get timeout(): number | undefined {
    return this._timeout;
  }

  get host(): string | undefined {
    return undefined; // Docker sandboxes don't expose a public host by default
  }

  readonly environmentDetails: string = `- All bash commands run in the working directory by default -- never prepend \`cd <working-directory> &&\`
- Use workspace-relative paths for read/write/search/edit operations
- Git is already configured (user, email, remote auth) - no setup needed
- GitHub CLI (gh) is NOT available - use git commands directly
- Node.js, Bun, and common build tools are available
- Dependencies may not be installed. Before running project scripts, check if \`node_modules\` exists and install if needed`;

  private constructor(
    container: Dockerode.Container,
    containerId: string,
    containerName: string,
    volumePath: string,
    workingDirectory: string,
    env?: Record<string, string>,
    currentBranch?: string,
    hooks?: SandboxHooks,
    timeout?: number,
    startTime?: number,
  ) {
    this.container = container;
    this.containerId = containerId;
    this.containerName = containerName;
    this.volumePath = volumePath;
    this.workingDirectory = workingDirectory;
    this.env = env;
    this.currentBranch = currentBranch;
    this.hooks = hooks;

    if (timeout !== undefined && startTime !== undefined) {
      this._timeout = timeout;
      this._expiresAt = startTime + timeout;
      this.scheduleProactiveStop();
    }
  }

  /**
   * Create a new Docker sandbox container.
   */
  static async create(config: DockerSandboxConfig): Promise<DockerSandbox> {
    const image =
      config.image ??
      process.env.SANDBOX_BASE_IMAGE ??
      DOCKER_DEFAULTS.defaultImage;
    const containerName =
      config.name ?? `machina-sandbox-${crypto.randomUUID().slice(0, 12)}`;
    const workspacesDir =
      process.env.SANDBOX_WORKSPACES_DIR ?? "/var/machina/workspaces";
    const volumePath = path.join(workspacesDir, containerName);
    const workingDirectory =
      process.env.SANDBOX_WORKING_DIR ?? DOCKER_DEFAULTS.workingDirectory;
    const timeout = config.timeout ?? DOCKER_DEFAULTS.timeout;

    // Create workspace directory on host
    await fs.mkdir(volumePath, { recursive: true });

    // Build environment variables for the container
    const containerEnv: string[] = [];
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        containerEnv.push(`${key}=${value}`);
      }
    }
    if (config.githubToken) {
      containerEnv.push(`GITHUB_TOKEN=${config.githubToken}`);
    }

    // Create and start the container
    const container = await docker.createContainer({
      Image: image,
      name: containerName,
      Env: containerEnv,
      WorkingDir: workingDirectory,
      Cmd: ["sleep", "infinity"], // Keep container alive
      HostConfig: {
        Binds: [`${volumePath}:${workingDirectory}`],
        NetworkMode: "bridge",
      },
      Labels: {
        "machina.sandbox": "true",
        "machina.sandbox.name": containerName,
      },
    });

    await container.start();
    const startTime = Date.now();
    const info = await container.inspect();
    const containerId = info.Id;

    const sandbox = new DockerSandbox(
      container,
      containerId,
      containerName,
      volumePath,
      workingDirectory,
      config.env,
      config.source?.newBranch ?? config.source?.branch,
      config.hooks,
      timeout,
      startTime,
    );

    // Configure git if user provided
    if (config.gitUser) {
      await sandbox.configureGitUser(config.gitUser);
    }

    // Configure git credential helper for GitHub token
    if (config.githubToken) {
      await sandbox.configureGitCredentials(config.githubToken);
    }

    // Clone repo if source provided
    if (config.source) {
      await sandbox.cloneSource(config.source, config.githubToken);
    }

    // Run afterStart hook
    if (config.hooks?.afterStart) {
      await config.hooks.afterStart(sandbox);
    }

    return sandbox;
  }

  /**
   * Connect to an existing Docker container by name or ID.
   */
  static async connect(
    containerNameOrId: string,
    options?: DockerSandboxConnectConfig,
  ): Promise<DockerSandbox> {
    const container = docker.getContainer(containerNameOrId);
    const info = await container.inspect();

    if (!info.State.Running) {
      // Restart stopped container
      await container.start();
    }

    const containerId = info.Id;
    const containerName = info.Name.replace(/^\//, "");

    // Resolve volume path from mount binds
    const binds = info.HostConfig?.Binds ?? [];
    const workspaceBind = binds.find((b: string) =>
      b.includes(DOCKER_DEFAULTS.workingDirectory),
    );
    const volumePath = workspaceBind?.split(":")[0] ?? "";

    // Detect current branch from the workspace
    let currentBranch: string | undefined;
    try {
      const branchResult = await execInContainer(
        container,
        "git rev-parse --abbrev-ref HEAD",
        DOCKER_DEFAULTS.workingDirectory,
        10_000,
      );
      if (branchResult.success) {
        currentBranch = branchResult.stdout.trim();
      }
    } catch {
      // Not a git repo or git not configured
    }

    const timeout = options?.remainingTimeout ?? DOCKER_DEFAULTS.timeout;

    return new DockerSandbox(
      container,
      containerId,
      containerName,
      volumePath,
      DOCKER_DEFAULTS.workingDirectory,
      options?.env,
      currentBranch,
      options?.hooks,
      timeout,
      Date.now(),
    );
  }

  // --- File operations (via host filesystem for performance) ---

  private hostPath(sandboxPath: string): string {
    // Convert sandbox-absolute paths to host volume paths
    if (sandboxPath.startsWith(this.workingDirectory)) {
      const relative = path.relative(this.workingDirectory, sandboxPath);
      return path.join(this.volumePath, relative);
    }
    // For relative paths, treat as relative to working directory
    if (!path.isAbsolute(sandboxPath)) {
      return path.join(this.volumePath, sandboxPath);
    }
    // Absolute paths outside working directory -- use container exec
    throw new Error(
      `Path ${sandboxPath} is outside the workspace. File operations are limited to ${this.workingDirectory}`,
    );
  }

  async readFile(filePath: string, _encoding: "utf-8"): Promise<string> {
    return fs.readFile(this.hostPath(filePath), "utf-8");
  }

  async writeFile(
    filePath: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    const hostFile = this.hostPath(filePath);
    await fs.mkdir(path.dirname(hostFile), { recursive: true });
    await fs.writeFile(hostFile, content, "utf-8");
  }

  async stat(filePath: string): Promise<SandboxStats> {
    const stats = await fs.stat(this.hostPath(filePath));
    return {
      isDirectory: () => stats.isDirectory(),
      isFile: () => stats.isFile(),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  async access(filePath: string): Promise<void> {
    await fs.access(this.hostPath(filePath));
  }

  async mkdir(
    dirPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fs.mkdir(this.hostPath(dirPath), options);
  }

  async readdir(
    dirPath: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    return fs.readdir(this.hostPath(dirPath), {
      withFileTypes: true,
    });
  }

  // --- Shell operations (via docker exec) ---

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    return execInContainer(
      this.container,
      command,
      cwd,
      timeoutMs,
      options?.signal,
    );
  }

  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    const commandId = crypto.randomUUID().slice(0, 8);
    const wrappedCommand = `nohup bash -c ${shellEscape(command)} > /tmp/machina-detached-${commandId}.log 2>&1 &`;

    const result = await execInContainer(
      this.container,
      wrappedCommand,
      cwd,
      DOCKER_DEFAULTS.detachedQuickFailureWindow,
    );

    if (!result.success) {
      throw new Error(
        `Detached command failed immediately: ${result.stderr || result.stdout}`,
      );
    }

    return { commandId };
  }

  domain(port: number): string {
    // For Docker, expose via localhost with published port
    return `http://localhost:${port}`;
  }

  async stop(): Promise<void> {
    if (this.isStopped) return;

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (error) {
        console.error(
          "[DockerSandbox] beforeStop hook failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    try {
      await this.container.stop({ t: 10 });
    } catch (error) {
      // Container may already be stopped
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("is not running") && !message.includes("304")) {
        throw error;
      }
    }

    try {
      await this.container.remove({ force: true });
    } catch {
      // Best effort removal
    }

    this.isStopped = true;
    this._expiresAt = undefined;
    this._timeout = undefined;
  }

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    if (this.isStopped) {
      throw new Error("Cannot extend timeout on stopped sandbox");
    }
    if (this._expiresAt === undefined) {
      throw new Error("Timeout tracking not enabled for this sandbox");
    }

    this._expiresAt += additionalMs;

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    this.scheduleProactiveStop();

    if (this.hooks?.onTimeoutExtended) {
      try {
        await this.hooks.onTimeoutExtended(this, additionalMs);
      } catch (error) {
        console.error(
          "[DockerSandbox] onTimeoutExtended hook failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return { expiresAt: this._expiresAt };
  }

  async snapshot(): Promise<SnapshotResult> {
    const snapshotName = `${this.containerName}-snapshot-${Date.now()}`;
    const commitResult = await this.container.commit({
      repo: snapshotName,
      tag: "latest",
    });
    await this.stop();
    return { snapshotId: commitResult.Id ?? snapshotName };
  }

  getState(): DockerState {
    return {
      containerId: this.containerId,
      containerName: this.containerName,
      volumePath: this.volumePath,
      expiresAt: this._expiresAt,
    };
  }

  // --- Private helpers ---

  private scheduleProactiveStop(): void {
    if (this._expiresAt === undefined) return;

    const msUntilTimeout = this._expiresAt - Date.now();
    if (msUntilTimeout <= 0) return;

    this.timeoutTimer = setTimeout(async () => {
      if (this.isStopped) return;

      if (this.hooks?.onTimeout) {
        try {
          await this.hooks.onTimeout(this);
        } catch (error) {
          console.error(
            "[DockerSandbox] onTimeout hook failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }
    }, msUntilTimeout);
  }

  private async configureGitUser(gitUser: {
    name: string;
    email: string;
  }): Promise<void> {
    await this.exec(
      `git config --global user.name "${gitUser.name}"`,
      this.workingDirectory,
      10_000,
    );
    await this.exec(
      `git config --global user.email "${gitUser.email}"`,
      this.workingDirectory,
      10_000,
    );
  }

  private async configureGitCredentials(token: string): Promise<void> {
    // Set up git credential helper to use the token for GitHub
    const credentialScript = [
      "#!/bin/bash",
      'echo "protocol=https"',
      'echo "host=github.com"',
      'echo "username=x-access-token"',
      `echo "password=${token}"`,
    ].join("\n");

    await this.exec(
      `printf '%s\\n' ${shellEscape(credentialScript)} > /tmp/git-credential-helper.sh && chmod +x /tmp/git-credential-helper.sh`,
      this.workingDirectory,
      10_000,
    );
    await this.exec(
      "git config --global credential.helper '/tmp/git-credential-helper.sh'",
      this.workingDirectory,
      10_000,
    );
  }

  private async cloneSource(
    source: {
      repo: string;
      branch?: string;
      token?: string;
      newBranch?: string;
    },
    githubToken?: string,
  ): Promise<void> {
    const token = source.token ?? githubToken;
    let cloneUrl = source.repo;

    // Add token to URL for authenticated clone
    if (token) {
      const match = cloneUrl.match(
        /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
      );
      if (match) {
        const [, owner, repo] = match;
        cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      }
    }

    const branchArg = source.branch ? `--branch ${source.branch}` : "";

    const result = await this.exec(
      `git clone ${branchArg} --single-branch ${shellEscape(cloneUrl)} .`,
      this.workingDirectory,
      120_000, // 2 minute timeout for clone
    );

    if (!result.success) {
      throw new Error(`Failed to clone repository: ${result.stderr}`);
    }

    // Create and checkout new branch if specified
    if (source.newBranch) {
      const checkoutResult = await this.exec(
        `git checkout -b ${shellEscape(source.newBranch)}`,
        this.workingDirectory,
        10_000,
      );
      if (!checkoutResult.success) {
        throw new Error(
          `Failed to create branch ${source.newBranch}: ${checkoutResult.stderr}`,
        );
      }
    }

    // Reconfigure credentials after clone (clone may override git config)
    if (token) {
      await this.configureGitCredentials(token);
    }
  }
}

// --- Helper functions ---

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

async function execInContainer(
  container: Dockerode.Container,
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  // Use child_process to run docker exec directly -- more reliable with Bun
  // than dockerode's hijack stream approach
  const { spawn } = await import("child_process");
  const info = await container.inspect();
  const containerIdOrName = info.Name.replace(/^\//, "");

  return new Promise<ExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let done = false;

    const proc = spawn(
      "docker",
      ["exec", "-w", cwd, containerIdOrName, "bash", "-c", command],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        proc.kill("SIGKILL");
        resolve({
          success: false,
          exitCode: null,
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr + "\n[Command timed out]"),
          truncated: true,
        });
      }
    }, timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          proc.kill("SIGKILL");
          resolve({
            success: false,
            exitCode: null,
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr + "\n[Command aborted]"),
            truncated: true,
          });
        }
      });
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (
        !truncated &&
        stdout.length + stderr.length > DOCKER_DEFAULTS.maxOutputLength
      ) {
        truncated = true;
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    proc.on("close", (exitCode: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        success: exitCode === 0,
        exitCode,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        truncated,
      });
    });

    proc.on("error", (err: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        success: false,
        exitCode: null,
        stdout: "",
        stderr: err.message,
        truncated: false,
      });
    });
  });
}

function truncateOutput(output: string): string {
  if (output.length <= DOCKER_DEFAULTS.maxOutputLength) {
    return output;
  }
  return (
    output.slice(0, DOCKER_DEFAULTS.maxOutputLength) + "\n[Output truncated]"
  );
}
