import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";

export interface CreateRepoOptions {
  installationToken: string;
  org: string;
  name: string;
  fromRepo: { owner: string; name: string; branch?: string };
  isPrivate: boolean;
  commitAuthor: { name: string; email: string };
  description?: string;
}

export interface CreateRepoResult {
  owner: string;
  name: string;
  defaultBranch: string;
  htmlUrl: string;
}

export async function createRepoFromTemplate(
  opts: CreateRepoOptions,
): Promise<CreateRepoResult> {
  const octokit = new Octokit({ auth: opts.installationToken });

  let createdOwner: string;
  let htmlUrl: string;
  try {
    const res = await octokit.repos.createInOrg({
      org: opts.org,
      name: opts.name,
      private: opts.isPrivate,
      description: opts.description,
      auto_init: false,
    });
    createdOwner = res.data.owner.login;
    htmlUrl = res.data.html_url;
  } catch (err) {
    const e = err as { status?: number; message?: string };
    throw new Error(
      `Failed to create repo ${opts.org}/${opts.name}: ${
        e.message ?? String(err)
      }`,
      { cause: err },
    );
  }

  const sourceBranch = opts.fromRepo.branch ?? "main";
  const tokenHost = `https://x-access-token:${opts.installationToken}@github.com`;
  const sourceUrl = `${tokenHost}/${opts.fromRepo.owner}/${opts.fromRepo.name}.git`;
  const targetUrl = `${tokenHost}/${opts.org}/${opts.name}.git`;

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: opts.commitAuthor.name,
    GIT_AUTHOR_EMAIL: opts.commitAuthor.email,
    GIT_COMMITTER_NAME: opts.commitAuthor.name,
    GIT_COMMITTER_EMAIL: opts.commitAuthor.email,
    GIT_TERMINAL_PROMPT: "0",
  } as NodeJS.ProcessEnv;

  const tempDir = mkdtempSync(join(tmpdir(), "factory-scaffold-"));
  const scaffoldDir = join(tempDir, "scaffold");

  try {
    runGit(
      `git clone --depth 1 --single-branch --branch ${shellEscape(sourceBranch)} ${shellEscape(sourceUrl)} ${shellEscape(scaffoldDir)}`,
      tempDir,
      gitEnv,
    );

    rmSync(join(scaffoldDir, ".git"), { recursive: true, force: true });

    runGit("git init -b main", scaffoldDir, gitEnv);
    runGit("git add -A", scaffoldDir, gitEnv);
    runGit(
      `git commit -m ${shellEscape(`Initial commit from ${opts.fromRepo.owner}/${opts.fromRepo.name}@${sourceBranch}`)}`,
      scaffoldDir,
      gitEnv,
    );
    runGit(
      `git remote add origin ${shellEscape(targetUrl)}`,
      scaffoldDir,
      gitEnv,
    );
    runGit("git push -u origin main", scaffoldDir, gitEnv);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    owner: createdOwner,
    name: opts.name,
    defaultBranch: "main",
    htmlUrl,
  };
}

function runGit(cmd: string, cwd: string, env: NodeJS.ProcessEnv): void {
  try {
    execSync(cmd, { cwd, env, stdio: "pipe" });
  } catch (err) {
    const e = err as { stderr?: Buffer; message?: string };
    const stderr = e.stderr?.toString() ?? "";
    throw new Error(
      `Git command failed (${cmd.split(" ")[1]}): ${stderr || e.message || String(err)}`,
      { cause: err },
    );
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
