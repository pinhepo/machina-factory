import { spawn } from "child_process";
import type { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import type { ExecResult, Sandbox, SandboxStats } from "../interface";

const MAX_OUTPUT_LENGTH = 500_000;
const WORKSPACES_DIR =
  process.env.SANDBOX_WORKSPACES_DIR ?? "/tmp/machina-workspaces";

interface LocalSandboxConfig {
  name?: string;
  source?: {
    repo: string;
    branch?: string;
    token?: string;
    newBranch?: string;
  };
  githubToken?: string;
  gitUser?: { name: string; email: string };
  timeout?: number;
}

/**
 * Local filesystem sandbox — runs commands directly via bash (no Docker).
 * Suitable for environments without Docker (Render, Railway, etc.).
 */
export class LocalSandbox implements Sandbox {
  readonly type = "docker" as const; // Keep compat with agent context type
  readonly workingDirectory: string;
  readonly currentBranch?: string;
  readonly volumePath: string;
  readonly containerId: string;
  readonly containerName: string;

  readonly environmentDetails = `- All bash commands run in the working directory by default -- never prepend \`cd <working-directory> &&\`
- Use workspace-relative paths for read/write/search/edit operations
- Git is already configured (user, email, remote auth) - no setup needed
- GitHub CLI (gh) is NOT available - use git commands directly
- Node.js and Bun are available
- Dependencies may not be installed. Before running project scripts, check if \`node_modules\` exists and install if needed`;

  private isStopped = false;
  private timeoutTimer?: ReturnType<typeof setTimeout>;

  private constructor(
    readonly sandboxDir: string,
    workingDirectory: string,
    currentBranch?: string,
  ) {
    this.volumePath = sandboxDir;
    this.workingDirectory = workingDirectory;
    this.containerId = path.basename(sandboxDir);
    this.containerName = path.basename(sandboxDir);
    this.currentBranch = currentBranch;
  }

  static async create(config: LocalSandboxConfig): Promise<LocalSandbox> {
    const name =
      config.name ?? `machina-local-${crypto.randomUUID().slice(0, 12)}`;
    const sandboxDir = path.join(WORKSPACES_DIR, name);
    const workingDirectory = sandboxDir;

    await fs.mkdir(sandboxDir, { recursive: true });

    const sandbox = new LocalSandbox(
      sandboxDir,
      workingDirectory,
      config.source?.newBranch ?? config.source?.branch,
    );

    if (config.gitUser) {
      await sandbox.exec(
        `git config --global user.name "${config.gitUser.name}"`,
        workingDirectory,
        10_000,
      );
      await sandbox.exec(
        `git config --global user.email "${config.gitUser.email}"`,
        workingDirectory,
        10_000,
      );
    }

    if (config.githubToken) {
      await sandbox.configureGitCredentials(config.githubToken);
    }

    if (config.source) {
      await sandbox.cloneSource(config.source, config.githubToken);
    }

    if (config.timeout) {
      sandbox.timeoutTimer = setTimeout(() => {
        sandbox.stop();
      }, config.timeout);
    }

    return sandbox;
  }

  // --- File operations (direct filesystem) ---

  async readFile(filePath: string, _encoding: "utf-8"): Promise<string> {
    return fs.readFile(this.resolvePath(filePath), "utf-8");
  }

  async writeFile(
    filePath: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    const resolved = this.resolvePath(filePath);
    console.log(
      `[LocalSandbox] writeFile: input="${filePath}" resolved="${resolved}" sandboxDir="${this.sandboxDir}"`,
    );
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    // Verify write
    try {
      const stat = await fs.stat(resolved);
      console.log(
        `[LocalSandbox] writeFile OK: ${resolved} (${stat.size} bytes)`,
      );
    } catch (e) {
      console.error(`[LocalSandbox] writeFile VERIFY FAILED: ${resolved}`, e);
    }
  }

  async stat(filePath: string): Promise<SandboxStats> {
    const stats = await fs.stat(this.resolvePath(filePath));
    return {
      isDirectory: () => stats.isDirectory(),
      isFile: () => stats.isFile(),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  async access(filePath: string): Promise<void> {
    await fs.access(this.resolvePath(filePath));
  }

  async mkdir(
    dirPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fs.mkdir(this.resolvePath(dirPath), options);
  }

  async readdir(
    dirPath: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    return fs.readdir(this.resolvePath(dirPath), { withFileTypes: true });
  }

  // --- Shell operations (direct bash exec) ---

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    return execLocal(command, cwd, timeoutMs, options?.signal);
  }

  async stop(): Promise<void> {
    if (this.isStopped) return;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
    // Clean up workspace directory
    try {
      await fs.rm(this.sandboxDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    this.isStopped = true;
  }

  getState() {
    return {
      containerId: this.containerId,
      containerName: this.containerName,
      volumePath: this.volumePath,
    };
  }

  // --- Private helpers ---

  private resolvePath(p: string): string {
    if (p.startsWith(this.workingDirectory)) {
      const relative = path.relative(this.workingDirectory, p);
      return path.join(this.sandboxDir, relative);
    }
    if (!path.isAbsolute(p)) {
      return path.join(this.sandboxDir, p);
    }
    throw new Error(
      `Path ${p} is outside the workspace ${this.workingDirectory}`,
    );
  }

  private async configureGitCredentials(token: string): Promise<void> {
    const credentialScript = [
      "#!/bin/bash",
      'echo "protocol=https"',
      'echo "host=github.com"',
      'echo "username=x-access-token"',
      `echo "password=${token}"`,
    ].join("\n");

    const scriptPath = `/tmp/git-cred-${path.basename(this.sandboxDir)}.sh`;
    await fs.writeFile(scriptPath, credentialScript, { mode: 0o755 });
    await this.exec(
      `git config --global credential.helper '${scriptPath}'`,
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

    // Ensure the workspace is empty before cloning (credential helper etc may have been written)
    const entries = await fs.readdir(this.sandboxDir);
    for (const entry of entries) {
      await fs.rm(path.join(this.sandboxDir, entry), {
        recursive: true,
        force: true,
      });
    }

    const result = await this.exec(
      `git clone ${branchArg} --single-branch ${shellEscape(cloneUrl)} .`,
      this.workingDirectory,
      120_000,
    );

    if (!result.success) {
      throw new Error(`Failed to clone repository: ${result.stderr}`);
    }

    if (source.newBranch) {
      const checkout = await this.exec(
        `git checkout -b ${shellEscape(source.newBranch)}`,
        this.workingDirectory,
        10_000,
      );
      if (!checkout.success) {
        throw new Error(
          `Failed to create branch ${source.newBranch}: ${checkout.stderr}`,
        );
      }
    }

    if (token) {
      await this.configureGitCredentials(token);
    }
  }
}

// --- Helpers ---

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function execLocal(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let done = false;

    const proc = spawn("bash", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME ?? "/root" },
    });

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        proc.kill("SIGKILL");
        resolve({
          success: false,
          exitCode: null,
          stdout: stdout.slice(0, MAX_OUTPUT_LENGTH),
          stderr: (stderr + "\n[Command timed out]").slice(
            0,
            MAX_OUTPUT_LENGTH,
          ),
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
            stdout: stdout.slice(0, MAX_OUTPUT_LENGTH),
            stderr: (stderr + "\n[Command aborted]").slice(
              0,
              MAX_OUTPUT_LENGTH,
            ),
            truncated: true,
          });
        }
      });
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (!truncated && stdout.length + stderr.length > MAX_OUTPUT_LENGTH) {
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
        stdout: stdout.slice(0, MAX_OUTPUT_LENGTH),
        stderr: stderr.slice(0, MAX_OUTPUT_LENGTH),
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
