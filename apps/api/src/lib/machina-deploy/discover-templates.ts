import type { Sandbox } from "@machina-factory/sandbox";

const SKIP_DIRS = new Set([
  ".refs",
  "node_modules",
  ".git",
  ".venv",
  "__pycache__",
  ".next",
  "dist",
]);
const MAX_DEPTH = 5;

export interface DiscoveredTemplate {
  /** Absolute path to the template directory (contains _install.yml) */
  dirPath: string;
  /** Path relative to workspace root */
  relativePath: string;
}

/**
 * Discover templates that were MODIFIED by the agent (not all templates in the repo).
 * Uses `git diff` to find changed files, then maps them to their parent template directories.
 * Falls back to discovering all templates if git diff fails.
 */
export async function discoverTemplates(
  sandbox: Sandbox,
  baseBranch?: string,
): Promise<DiscoveredTemplate[]> {
  // Get list of changed files via git. When git says nothing changed we
  // DO NOT walk the whole repo — pre-existing templates often have
  // cross-directory references (e.g. ../../connectors/X) that don't
  // zip cleanly per-template, so a blanket re-push floods the API with
  // false failures. Better to push nothing than everything.
  const changedDirs = await getChangedTemplateDirs(sandbox, baseBranch);
  if (changedDirs === null) {
    return [];
  }

  const results: DiscoveredTemplate[] = [];
  for (const dir of changedDirs) {
    const absPath = `${sandbox.workingDirectory}/${dir}`;
    try {
      await sandbox.access(`${absPath}/_install.yml`);
      results.push({ dirPath: absPath, relativePath: dir });
    } catch {
      // Changed files are not in a template directory — skip
    }
  }
  return results;
}

/**
 * Get the set of template directories that contain changed files.
 * Returns null if nothing could be determined (caller falls back to full discovery).
 *
 * Runs after the agent has committed its changes, so we try multiple
 * strategies in order of reliability:
 *   1. `git log --name-only origin/<base>..HEAD` — commits since fork point
 *   2. `git log --name-only <base>..HEAD` — local baseline
 *   3. `git show --name-only HEAD` — last commit only (single-commit flow)
 *   4. `git diff HEAD` + `--cached` — uncommitted fallback
 */
async function getChangedTemplateDirs(
  sandbox: Sandbox,
  baseBranch?: string,
): Promise<Set<string> | null> {
  const attempts: string[] = [];
  if (baseBranch) {
    attempts.push(
      `git log --name-only --pretty=format: "origin/${baseBranch}..HEAD" 2>/dev/null`,
      `git log --name-only --pretty=format: "${baseBranch}..HEAD" 2>/dev/null`,
    );
  }
  attempts.push(
    "git show --name-only --pretty=format: HEAD 2>/dev/null",
    "git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null",
  );

  for (const cmd of attempts) {
    try {
      const result = await sandbox.exec(
        cmd,
        sandbox.workingDirectory,
        10_000,
      );
      if (result.success && result.stdout.trim()) {
        return mapFilesToTemplateDirs(result.stdout);
      }
    } catch {
      // try next attempt
    }
  }
  return null;
}

/**
 * Given a list of changed file paths, find the parent directories that contain _install.yml.
 * For example, if "agent-templates/my-agent/workflows/main.yml" changed,
 * returns "agent-templates/my-agent" (assuming it has _install.yml).
 */
function mapFilesToTemplateDirs(diffOutput: string): Set<string> {
  const dirs = new Set<string>();
  const lines = diffOutput.trim().split("\n").filter(Boolean);

  for (const file of lines) {
    // Walk up the path to find potential template directories
    const parts = file.split("/");
    for (let i = parts.length - 1; i >= 1; i--) {
      const dir = parts.slice(0, i).join("/");
      dirs.add(dir);
    }
  }

  return dirs;
}

async function walk(
  sandbox: Sandbox,
  basePath: string,
  relative: string,
  depth: number,
  results: DiscoveredTemplate[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const currentPath = relative ? `${basePath}/${relative}` : basePath;

  // Check if _install.yml exists in this directory
  try {
    await sandbox.access(`${currentPath}/_install.yml`);
    results.push({
      dirPath: currentPath,
      relativePath: relative || ".",
    });
    // Don't recurse into template directories — they're self-contained
    return;
  } catch {
    // No _install.yml here, keep walking
  }

  // Recurse into subdirectories
  let entries: Awaited<ReturnType<Sandbox["readdir"]>>;
  try {
    entries = await sandbox.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      SKIP_DIRS.has(entry.name) ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    await walk(sandbox, basePath, childRelative, depth + 1, results);
  }
}
