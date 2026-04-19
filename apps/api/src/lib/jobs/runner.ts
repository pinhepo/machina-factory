import { z } from "zod";
import { machinaAgent, sumLanguageModelUsage } from "@machina-factory/agent";
import type { AgentSandboxContext } from "@machina-factory/agent";
import { type SandboxState } from "@machina-factory/sandbox";
import { DockerSandbox } from "@machina-factory/sandbox/docker";
import { LocalSandbox } from "@machina-factory/sandbox/local";
import {
  convertToModelMessages,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessage,
} from "ai";
import type {
  DeployConfig,
  Job,
  JobResult,
  JobUsage,
  VerificationResult,
} from "../db/schema";
import { createRepoFromTemplate } from "../github/create-repo";
import { deployTemplates, triggerRedeploy } from "../machina-deploy";
import { MACHINA_CLI_CONTEXT } from "../machina-cli-context";
import { createJobLogger, type JobLogger } from "./logger";
import { isJobCancelled, updateJobStatus } from "./queue";
import { completeStep, startStep } from "./steps";

const SANDBOX_MODE = process.env.SANDBOX_MODE ?? "docker";
const MAX_AGENT_STEPS = 200;
const MAX_STEP_RETRIES = 3;
const STEP_TIMEOUT_MS = 120_000; // 2 min per step
const SANDBOX_TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS ?? 1_800_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RunJobOptions {
  /** GitHub installation token for repo access */
  githubToken: string;
  /** Git user identity for commits */
  gitUser: { name: string; email: string };
  /** Machina platform deploy config (from project settings) */
  deployConfig?: DeployConfig;
  /** Machina organization ID (for redeploy trigger) */
  machinaOrgId?: string;
  /** Machina project ID (for CLI config) */
  machinaProjectId?: string;
}

/**
 * Execute a complete job lifecycle:
 * provision -> agent loop -> verify -> commit -> PR -> complete
 */
export async function runJob(job: Job, options: RunJobOptions): Promise<void> {
  const log = createJobLogger(job.id);

  try {
    // 0. Create new repo from template if configured
    if (job.createRepoConfig) {
      await runCreateRepoStep(job, options, log);
    }

    // 1. Provision sandbox
    const sandbox = await provisionSandbox(job, options, log);
    const sandboxState = sandbox.getState?.() as SandboxState | undefined;

    if (sandboxState) {
      await updateJobStatus(job.id, "provisioning", { sandboxState });
    }

    // 1.5. Clone reference repos (if any)
    if (job.referenceRepos && job.referenceRepos.length > 0) {
      await cloneReferenceRepos(job, sandbox, options, log);
    }

    // 1.6. Configure machina-cli (if deploy config has API key)
    const { deployConfig } = options;
    if (deployConfig?.machinaApiKey) {
      await configureMachinaCli(
        sandbox,
        deployConfig,
        options.machinaOrgId,
        options.machinaProjectId,
        log,
      );
    }

    // 2. Run agent loop
    await updateJobStatus(job.id, "running");
    const agentLoopResult = await runAgentLoop(job, sandbox, log);
    const agentUsage = agentLoopResult.usage;

    // Check for cancellation
    if (await isJobCancelled(job.id)) {
      await sandbox.stop();
      return;
    }

    if (job.mode === "plan") {
      try {
        const planResult = await extractPlanJson(sandbox, log);
        const result: JobResult = { plan: planResult };
        await updateJobStatus(job.id, "completed", {
          result,
          completedAt: new Date(),
          usage: agentUsage,
        });
        await log.info("Plan completed successfully", { result });
        if (job.callbackUrl) {
          await sendCallback(job.callbackUrl, {
            jobId: job.id,
            status: "completed",
            result,
          });
        }
      } catch (err) {
        throw new Error("Plan missing or invalid", { cause: err });
      }
      await sandbox.stop();
      return;
    }

    // 3. Check whether the agent actually modified any files. If not, the
    // task was probably an execute/inspect/chat-style ask that Factory
    // is not built for — skip commit/push/PR/deploy to avoid empty PRs
    // and noisy deploy attempts. The user still gets a clean job-detail
    // showing what the agent investigated, plus an explicit 'no_code_changes'
    // flag in the result so the UI can call it out.
    const hasChanges = await hasWorkingTreeChanges(sandbox, log);
    if (!hasChanges) {
      await log.warn(
        "Agent loop finished with no file changes — skipping commit/push/PR/deploy",
      );
      const result: JobResult = {
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
        noCodeChanges: true,
      };
      await updateJobStatus(job.id, "completed", {
        result,
        completedAt: new Date(),
        usage: agentUsage,
      });
      await log.info(
        "Job completed without code changes. If you meant to execute/run/test something, Factory is not the right surface for that today — use `machina workflow run` or `machina agent run` from the CLI.",
      );
      if (job.callbackUrl) {
        await sendCallback(job.callbackUrl, {
          jobId: job.id,
          status: "completed",
          result,
        });
      }
      await sandbox.stop();
      return;
    }

    // 4. Verify
    await updateJobStatus(job.id, "verifying");
    const verificationResults = await runVerification(job, sandbox, log);

    // 5. Commit and push
    await updateJobStatus(job.id, "committing");
    const commitResult = await commitAndPush(job, sandbox, options, log);

    // 6. Create PR
    const prResult = await createPullRequest(job, sandbox, options, log);

    // 6. Deploy templates to Machina platform (if configured)
    let deployResults: JobResult["deployResults"];

    if (
      deployConfig?.autoPushTemplates &&
      deployConfig.clientApiUrl &&
      deployConfig.machinaApiKey
    ) {
      await updateJobStatus(job.id, "deploying");
      const deployStepId = await startStep(job.id, "deploy_templates");

      try {
        deployResults = await deployTemplates(
          sandbox,
          deployConfig,
          log,
          job.baseBranch,
        );
        const allPushed = deployResults.every((r) => r.pushed);
        await completeStep(deployStepId, allPushed ? "completed" : "failed", {
          results: deployResults,
        });
      } catch (deployError) {
        const deployMsg =
          deployError instanceof Error
            ? deployError.message
            : String(deployError);
        await log.warn(`Deploy phase failed: ${deployMsg}`);
        await completeStep(deployStepId, "failed", { error: deployMsg });
      }

      // Trigger client-api redeploy if configured
      if (deployConfig.autoRedeploy && options.machinaOrgId) {
        const redeployStepId = await startStep(job.id, "deploy_trigger");
        const redeployOk = await triggerRedeploy(
          deployConfig,
          options.machinaOrgId,
          log,
        );
        await completeStep(redeployStepId, redeployOk ? "completed" : "failed");
      }
    }

    // 7. Build final result
    const diffStats = await getDiffStats(sandbox, job);
    const result: JobResult = {
      filesChanged: diffStats.filesChanged,
      linesAdded: diffStats.linesAdded,
      linesRemoved: diffStats.linesRemoved,
      commitSha: commitResult?.sha,
      prNumber: prResult?.number,
      prUrl: prResult?.url,
      verificationResults,
      deployResults,
    };

    // 8. Complete
    await updateJobStatus(job.id, "completed", {
      result,
      completedAt: new Date(),
      usage: agentUsage,
    });
    await log.info("Job completed successfully", { result });

    // 9. Callback if configured
    if (job.callbackUrl) {
      await sendCallback(job.callbackUrl, {
        jobId: job.id,
        status: "completed",
        result,
      });
    }

    // 10. Cleanup sandbox
    await sandbox.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log.error(`Job failed: ${message}`);
    await updateJobStatus(job.id, "failed", {
      error: message,
      completedAt: new Date(),
    });

    if (job.callbackUrl) {
      await sendCallback(job.callbackUrl, {
        jobId: job.id,
        status: "failed",
        error: message,
      }).catch(() => {});
    }
  }
}

// --- Phase: Create Repo ---

async function runCreateRepoStep(
  job: Job,
  options: RunJobOptions,
  log: JobLogger,
): Promise<void> {
  const cfg = job.createRepoConfig;
  if (!cfg) return;

  const stepId = await startStep(job.id, "create_repo");
  await log.info(
    `Creating new repo ${cfg.org}/${cfg.name} from ${cfg.fromRepo.repoOwner}/${cfg.fromRepo.repoName}`,
  );

  try {
    const result = await createRepoFromTemplate({
      installationToken: options.githubToken,
      org: cfg.org,
      name: cfg.name,
      fromRepo: {
        owner: cfg.fromRepo.repoOwner,
        name: cfg.fromRepo.repoName,
        branch: cfg.fromRepo.branch,
      },
      isPrivate: cfg.private,
      commitAuthor: options.gitUser,
      description: cfg.description,
    });

    await completeStep(stepId, "completed", {
      owner: result.owner,
      name: result.name,
      htmlUrl: result.htmlUrl,
    });
    await log.info(`Repo created: ${result.htmlUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeStep(stepId, "failed", { error: message });
    throw error;
  }
}

// --- Phase: Provision ---

async function provisionSandbox(
  job: Job,
  options: RunJobOptions,
  log: JobLogger,
): Promise<DockerSandbox | LocalSandbox> {
  const stepId = await startStep(job.id, "clone");
  await log.info(
    `Provisioning ${SANDBOX_MODE} sandbox for ${job.repoOwner}/${job.repoName}`,
  );

  // When continuing a job, baseBranch and workBranch are the same —
  // don't create a new branch, just clone and work on the existing one.
  const isContinuation = job.workBranch === job.baseBranch;

  const sandboxConfig = {
    name: `machina-job-${job.id}`,
    source: {
      repo: `https://github.com/${job.repoOwner}/${job.repoName}`,
      branch: job.baseBranch,
      token: options.githubToken,
      newBranch: isContinuation ? undefined : job.workBranch,
    },
    githubToken: options.githubToken,
    gitUser: options.gitUser,
    timeout: SANDBOX_TIMEOUT_MS,
  };

  try {
    const sandbox =
      SANDBOX_MODE === "local"
        ? await LocalSandbox.create(sandboxConfig)
        : await DockerSandbox.create(sandboxConfig);

    await completeStep(stepId, "completed", {
      containerId: sandbox.containerId,
    });
    await log.info("Sandbox provisioned and repo cloned");
    return sandbox;
  } catch (error) {
    await completeStep(stepId, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// --- Phase: Agent Loop ---

interface AgentLoopResult {
  messages: ModelMessage[];
  usage?: JobUsage;
}

async function runAgentLoop(
  job: Job,
  sandbox: DockerSandbox | LocalSandbox,
  log: JobLogger,
): Promise<AgentLoopResult> {
  const stepId = await startStep(job.id, "agent_loop");
  await log.info("Starting coding agent loop");

  const sandboxState =
    SANDBOX_MODE === "local"
      ? { type: "local" as const, instance: sandbox }
      : {
          type: "docker" as const,
          containerId: (sandbox as DockerSandbox).containerId,
          containerName: (sandbox as DockerSandbox).containerName,
          volumePath: (sandbox as DockerSandbox).volumePath,
        };

  const sandboxContext: AgentSandboxContext = {
    state: sandboxState,
    workingDirectory: sandbox.workingDirectory,
    currentBranch: job.workBranch,
    environmentDetails: sandbox.environmentDetails,
  };

  const refRepoLines = buildReferenceRepoContext(job);
  const projectContextLines = buildStudioProjectContext(job);
  let instructionsLines = [
    "You are running in autonomous mode as part of Machina Factory.",
    "Complete the task without asking questions -- make your best judgment on any decisions.",
    "Do not use the ask_user_question tool.",
    "Focus on implementing the requested changes, then stop.",
    "",
    MACHINA_CLI_CONTEXT,
    ...projectContextLines,
    ...refRepoLines,
  ];

  if (job.mode === "plan") {
    const alreadyClarifiedOnce =
      job.origin === "continuation" &&
      typeof job.task === "string" &&
      job.task.includes("Clarifying answers:");

    instructionsLines.push(
      "",
      "You are running in PLANNING MODE. Your job is to decompose the user's",
      "intent into a list of independent child jobs, each scoped to ONE repo.",
      "",
      "HARD RULES:",
      "- DO NOT modify any files except creating PLAN.json at the workspace root.",
      "- DO NOT run any build, test, commit, push, or deployment commands.",
      "- DO NOT attempt network mutations.",
      "",
      "You MAY freely: read, grep, glob, explore files, look at reference repos.",
      "",
      "Write the final plan to PLAN.json at the workspace root. It MUST be one",
      "of the following two shapes.",
      "",
      'Shape A ("ready" — you have enough to plan):',
      "{",
      '  "status": "ready",',
      '  "summary": "one-sentence summary of the overall intent",',
      '  "items": [',
      "    {",
      '      "task": "detailed prompt for this child job",',
      '      "repoOwner": "machina-sports",',
      '      "repoName": "sportingbot-web",',
      '      "baseBranch": "main",',
      '      "origin": "queue_child"',
      "    }",
      "  ]",
      "}",
      "",
      'Shape B ("clarify" — the task is ambiguous and 2-4 questions would',
      "materially change your plan):",
      "{",
      '  "status": "clarify",',
      '  "reason": "optional, one-sentence why you need to ask",',
      '  "questions": [',
      "    {",
      '      "id": "stable-kebab-id",',
      '      "question": "the question to ask the user",',
      '      "options": ["optional", "multiple-choice", "answers"],',
      '      "why": "optional short hint shown below the question"',
      "    }",
      "  ]",
      "}",
      "",
      "Rules for clarify:",
      "- Ask 2-4 questions, never more.",
      "- Only ask when an answer would materially change WHICH repos or HOW",
      "  MANY jobs you produce (e.g. frontend vs backend vs both; one scope or",
      "  split; which repo of several candidates).",
      "- Prefer shape A whenever the prompt is unambiguous; don't ask for",
      "  stylistic preferences you can reasonably assume.",
      "- Provide options[] when the answer is truly a small discrete set;",
      "  otherwise omit it and the user will type a free-text answer.",
      "",
      "Ordering matters for Shape A -- earlier items are dependencies of later",
      "ones. Keep the plan small (2-6 items typically). Each item's task must",
      "be rich enough to stand alone without the high-order context.",
      "",
      "### Execute vs. build — both shapes are valid ###",
      "Factory jobs come in two shapes and you should pick the right one:",
      "",
      "- BUILD: user wants files added/modified in a repo. Plan normally,",
      "  decompose into queue items, each targeting a repo + task.",
      "- EXECUTE: user wants an operation run once (run workflow, inspect",
      "  agent, check status). The sandbox already has machina-cli, so",
      "  child jobs can invoke commands and report output — no commit/PR",
      "  needed. Emit a single-item plan whose task instructs the coding",
      "  agent to run the CLI and report back the output, cleanly.",
      "",
      "When to CLARIFY (Shape B) instead of planning:",
      "- The prompt mixes intent (\"set up a morning briefing\" could be",
      "  build OR execute) and the answer would change the shape.",
      "- The user didn't say which repo to touch and there are obvious",
      "  candidates (e.g. frontend vs backend).",
      "",
      "When NOT to clarify: if the prompt is already unambiguous (imperative",
      "\"run\" / \"list\" / \"check\" reads execute; \"add\" / \"create\" /",
      "\"implement\" reads build), just plan Shape A directly.",
      "",
      "NEVER try to execute commands yourself in plan mode — planning tasks",
      "CANNOT make network calls or modify anything except PLAN.json.",
    );

    if (alreadyClarifiedOnce) {
      instructionsLines.push(
        "",
        "NOTE: the user has already answered one round of clarifying questions",
        "(see the 'Clarifying answers' block in the task). You MUST now emit",
        'Shape A ("ready"). Do not ask another round of questions.',
      );
    }
  }

  const autonomousInstructions = instructionsLines.join("\n");

  const messages: UIMessage[] = [
    {
      id: "task-prompt",
      role: "user",
      parts: [{ type: "text", text: job.task }],
    },
  ];

  let modelMessages: ModelMessage[] = [];
  let stepCount = 0;
  let cumulativeUsage: LanguageModelUsage | undefined;
  let stepsWithUsage = 0;

  try {
    // Convert initial messages
    modelMessages = await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools: {},
    });

    // Agent step loop
    while (stepCount < MAX_AGENT_STEPS) {
      // Check cancellation periodically
      if (stepCount > 0 && stepCount % 10 === 0) {
        if (await isJobCancelled(job.id)) {
          await log.info("Job cancelled during agent loop");
          break;
        }
      }

      let finishReason: string | undefined = undefined;
      let succeeded = false;
      for (let retry = 0; retry < MAX_STEP_RETRIES; retry++) {
        try {
          const stepAbort = new AbortController();
          const stepTimer = setTimeout(
            () => stepAbort.abort(),
            STEP_TIMEOUT_MS,
          );

          const result = await machinaAgent.stream({
            messages: modelMessages,
            options: {
              sandbox: sandboxContext,
              customInstructions: autonomousInstructions,
              ...(job.modelId ? { model: job.modelId } : {}),
            },
            abortSignal: stepAbort.signal,
          });

          // Collect the full response (with timeout protection)
          const response = await result.response;
          finishReason = await result.finishReason;
          clearTimeout(stepTimer);
          const warnings = await result.warnings;
          if (warnings && warnings.length > 0) {
            await log.warn(
              `Agent warnings: ${JSON.stringify(warnings).slice(0, 500)}`,
            );
          }

          // Append response messages to conversation history
          modelMessages = [...modelMessages, ...response.messages];

          // Accumulate token usage across steps. totalUsage may reject on
          // some models/providers that don't report usage — treat as optional.
          try {
            const stepUsage = await result.totalUsage;
            if (stepUsage) {
              cumulativeUsage = sumLanguageModelUsage(
                cumulativeUsage,
                stepUsage,
              );
              stepsWithUsage++;
            }
          } catch {
            // usage unavailable — continue without it
          }

          succeeded = true;
          break;
        } catch (agentError) {
          const errMsg =
            agentError instanceof Error
              ? agentError.message
              : String(agentError);
          // Dig out the underlying provider error (Anthropic/OpenAI/etc.
          // return structured AI_APICallError instances whose root cause
          // lives in .cause or in the serialized body).
          const errDetails = extractAgentErrorDetails(agentError);

          const isRetryable =
            errMsg.includes("No output generated") ||
            errMsg.includes("UNAVAILABLE") ||
            errMsg.includes("high demand") ||
            errMsg.includes("Gateway") ||
            errMsg.includes("Unable to connect") ||
            errMsg.includes("fetch failed") ||
            errMsg.includes("aborted") ||
            errMsg.includes("timed out") ||
            errMsg.includes("AbortError") ||
            errMsg.includes("503") ||
            errMsg.includes("429");

          if (isRetryable && retry < MAX_STEP_RETRIES - 1) {
            const delayMs = (retry + 1) * 5000;
            await log.warn(
              `Agent step ${stepCount + 1} failed (attempt ${retry + 1}/${MAX_STEP_RETRIES}): ${errMsg.slice(0, 200)}${errDetails ? ` [${errDetails.slice(0, 400)}]` : ""}. Retrying in ${delayMs / 1000}s...`,
            );
            await sleep(delayMs);
            continue;
          }

          await log.error(
            `Agent step ${stepCount + 1} error: ${errMsg}${errDetails ? `\n  provider: ${errDetails}` : ""}`,
          );
          throw agentError;
        }
      }
      if (!succeeded) {
        throw new Error("Agent step failed after all retries");
      }
      stepCount++;

      // Log detailed tool call info — check last few messages for assistant tool calls
      let toolSummaries: string[] = [];
      for (
        let mi = modelMessages.length - 1;
        mi >= Math.max(0, modelMessages.length - 5);
        mi--
      ) {
        toolSummaries = extractToolSummaries(modelMessages[mi]);
        if (toolSummaries.length > 0) break;
      }
      // Also log tool results (errors)
      const toolErrors = extractToolErrors(modelMessages);
      for (const err of toolErrors) {
        await log.warn(`[step ${stepCount}] ${err}`);
      }
      if (toolSummaries.length > 0) {
        for (const summary of toolSummaries) {
          await log.info(`[step ${stepCount}] ${summary}`);
        }
      } else {
        await log.info(`Agent step ${stepCount}: finishReason=${finishReason}`);
      }

      // Checkpoint agent state to DB periodically
      if (stepCount % 5 === 0) {
        await updateJobStatus(job.id, "running", {
          agentMessages: modelMessages as unknown as Job["agentMessages"],
          usage: buildJobUsage(cumulativeUsage, stepsWithUsage, job.modelId),
        });
      }

      // Stop if the agent finished naturally
      if (finishReason === "stop" || finishReason === "length") {
        break;
      }

      // Log and stop on errors
      if (finishReason === "error") {
        await log.error("Agent returned error finishReason -- stopping loop");
        break;
      }

      // Continue if there are tool calls to process
      if (finishReason !== "tool-calls") {
        await log.warn(`Unexpected finishReason: ${finishReason} -- stopping`);
        break;
      }
    }

    await completeStep(stepId, "completed", {
      totalSteps: stepCount,
    });
    await log.info(`Agent loop completed after ${stepCount} steps`);
    return {
      messages: modelMessages,
      usage: buildJobUsage(cumulativeUsage, stepsWithUsage, job.modelId),
    };
  } catch (error) {
    await completeStep(stepId, "failed", {
      error: error instanceof Error ? error.message : String(error),
      totalSteps: stepCount,
    });
    throw error;
  }
}

// --- Phase: Verification ---

async function runVerification(
  job: Job,
  sandbox: DockerSandbox | LocalSandbox,
  log: JobLogger,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  // Detect project type by checking for common config files
  const hasPackageJson = await fileExists(sandbox, "package.json");

  if (!hasPackageJson) {
    await log.info("No package.json found, skipping verification steps");
    return results;
  }

  // Read package.json to determine available scripts
  let scripts: Record<string, string> = {};
  try {
    const content = await sandbox.readFile(
      `${sandbox.workingDirectory}/package.json`,
      "utf-8",
    );
    const pkg = JSON.parse(content);
    scripts = pkg.scripts ?? {};
  } catch {
    await log.warn("Could not read package.json scripts");
    return results;
  }

  // Check if deps are installed
  const hasNodeModules = await fileExists(sandbox, "node_modules");
  if (!hasNodeModules) {
    await log.info("Installing dependencies...");
    const installResult = await sandbox.exec(
      detectPackageManager(scripts) === "bun" ? "bun install" : "npm install",
      sandbox.workingDirectory,
      120_000,
    );
    if (!installResult.success) {
      await log.warn("Dependency installation failed, continuing anyway");
    }
  }

  // Run available verification steps
  const checks: Array<{
    step: "verify_tests" | "verify_lint" | "verify_build" | "verify_typecheck";
    scriptNames: string[];
    label: string;
  }> = [
    {
      step: "verify_typecheck",
      scriptNames: ["typecheck", "type-check"],
      label: "Type check",
    },
    { step: "verify_lint", scriptNames: ["lint", "check"], label: "Lint" },
    { step: "verify_tests", scriptNames: ["test", "test:ci"], label: "Tests" },
    { step: "verify_build", scriptNames: ["build"], label: "Build" },
  ];

  for (const check of checks) {
    const scriptNames = check.scriptNames;
    const scriptName = scriptNames.find((s) => scripts[s]);
    if (!scriptName) continue;

    const stepId = await startStep(job.id, check.step);
    await log.info(`Running ${check.label}...`);

    const pm = detectPackageManager(scripts);
    const cmd =
      pm === "bun" ? `bun run ${scriptName}` : `npm run ${scriptName}`;

    const execResult = await sandbox.exec(
      cmd,
      sandbox.workingDirectory,
      300_000, // 5 minute timeout for verification
    );

    const passed = execResult.success;
    const output = (execResult.stdout + execResult.stderr).slice(0, 10_000);

    results.push({ step: check.step, passed, output });
    await completeStep(stepId, passed ? "completed" : "failed", {
      exitCode: execResult.exitCode,
      output,
    });
    await log.info(`${check.label}: ${passed ? "PASSED" : "FAILED"}`);
  }

  return results;
}

// --- Phase: Commit & Push ---

async function commitAndPush(
  job: Job,
  sandbox: DockerSandbox | LocalSandbox,
  options: RunJobOptions,
  log: JobLogger,
): Promise<{ sha: string } | null> {
  // Debug: log what's in the workspace
  const debugLs = await sandbox.exec("ls -la", sandbox.workingDirectory, 5_000);
  await log.info(
    `[debug] workspace contents:\n${debugLs.stdout.slice(0, 500)}`,
  );
  const debugGitDir = await sandbox.exec(
    "git rev-parse --show-toplevel",
    sandbox.workingDirectory,
    5_000,
  );
  await log.info(`[debug] git root: ${debugGitDir.stdout.trim()}`);
  const debugPwd = await sandbox.exec("pwd", sandbox.workingDirectory, 5_000);
  await log.info(
    `[debug] cwd: ${debugPwd.stdout.trim()}, sandbox.workingDirectory: ${sandbox.workingDirectory}`,
  );

  // Check for changes
  const statusResult = await sandbox.exec(
    "git status --porcelain",
    sandbox.workingDirectory,
    10_000,
  );

  if (!statusResult.stdout.trim()) {
    await log.info("No changes to commit");
    return null;
  }

  const commitStepId = await startStep(job.id, "commit");
  await log.info("Committing changes...");

  // Ensure .refs/ is excluded from git (reference repos are read-only context)
  await sandbox.exec(
    "echo '.refs/' >> .gitignore 2>/dev/null; git rm -rf --cached .refs 2>/dev/null || true",
    sandbox.workingDirectory,
    10_000,
  );

  // Stage all changes
  await sandbox.exec("git add -A", sandbox.workingDirectory, 30_000);

  // Generate a commit message based on the task
  const commitMessage = `feat: ${job.task.slice(0, 72)}\n\nAutomated by Machina Factory\nJob: ${job.id}`;

  const commitResult = await sandbox.exec(
    `git commit -m ${shellEscape(commitMessage)}`,
    sandbox.workingDirectory,
    30_000,
  );

  if (!commitResult.success) {
    await completeStep(commitStepId, "failed", {
      error: commitResult.stderr,
    });
    throw new Error(`Commit failed: ${commitResult.stderr}`);
  }

  // Get commit SHA
  const shaResult = await sandbox.exec(
    "git rev-parse HEAD",
    sandbox.workingDirectory,
    10_000,
  );
  const sha = shaResult.stdout.trim();

  await completeStep(commitStepId, "completed", { sha });
  await log.info(`Committed: ${sha.slice(0, 8)}`);

  // Push
  const pushStepId = await startStep(job.id, "push");
  const pushResult = await sandbox.exec(
    `git push -u origin ${shellEscape(job.workBranch)}`,
    sandbox.workingDirectory,
    60_000,
  );

  if (!pushResult.success) {
    await completeStep(pushStepId, "failed", {
      error: pushResult.stderr,
    });
    throw new Error(`Push failed: ${pushResult.stderr}`);
  }

  await completeStep(pushStepId, "completed");
  await log.info(`Pushed to ${job.workBranch}`);

  return { sha };
}

// --- Phase: Create PR ---

async function createPullRequest(
  job: Job,
  sandbox: DockerSandbox | LocalSandbox,
  options: RunJobOptions,
  log: JobLogger,
): Promise<{ number: number; url: string } | null> {
  const stepId = await startStep(job.id, "create_pr");
  await log.info("Creating pull request...");

  try {
    const prTitle = `[Machina] ${job.task.slice(0, 100)}`;
    const prBody = [
      `## Automated by Machina Factory`,
      "",
      `**Task:** ${job.task}`,
      `**Job ID:** ${job.id}`,
      `**Repository:** ${job.repoOwner}/${job.repoName}`,
      `**Branch:** ${job.workBranch} -> ${job.baseBranch}`,
    ].join("\n");

    // Use fetch directly with the GitHub token (works in both Docker and Local sandbox)
    const response = await fetch(
      `https://api.github.com/repos/${job.repoOwner}/${job.repoName}/pulls`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${options.githubToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: prTitle,
          head: job.workBranch,
          base: job.baseBranch,
          body: prBody,
        }),
      },
    );

    const prData = (await response.json()) as {
      number?: number;
      html_url?: string;
      errors?: Array<{ message?: string }>;
    };

    if (prData.number) {
      await completeStep(stepId, "completed", {
        prNumber: prData.number,
        prUrl: prData.html_url,
      });
      await log.info(`PR #${prData.number} created: ${prData.html_url}`);
      return { number: prData.number, url: prData.html_url ?? "" };
    }

    // PR may already exist
    if (
      prData.errors?.some((e: { message?: string }) =>
        e.message?.includes("already exists"),
      )
    ) {
      await completeStep(stepId, "skipped", {
        reason: "PR already exists",
      });
      await log.info("PR already exists for this branch");
      return null;
    }

    await completeStep(stepId, "failed", { response: prData });
    await log.warn("Unexpected PR API response", { response: prData });
    return null;
  } catch (error) {
    await completeStep(stepId, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// --- Helpers ---

async function getDiffStats(
  sandbox: DockerSandbox | LocalSandbox,
  job: Job,
): Promise<{ filesChanged: number; linesAdded: number; linesRemoved: number }> {
  try {
    const result = await sandbox.exec(
      `git diff --stat ${shellEscape(job.baseBranch)}...HEAD`,
      sandbox.workingDirectory,
      10_000,
    );

    if (!result.success) {
      return { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
    }

    const lines = result.stdout.trim().split("\n");
    const summaryLine = lines[lines.length - 1] ?? "";

    const filesMatch = summaryLine.match(/(\d+) files? changed/);
    const addedMatch = summaryLine.match(/(\d+) insertions?/);
    const removedMatch = summaryLine.match(/(\d+) deletions?/);

    return {
      filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
      linesAdded: addedMatch ? Number(addedMatch[1]) : 0,
      linesRemoved: removedMatch ? Number(removedMatch[1]) : 0,
    };
  } catch {
    return { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
  }
}

async function fileExists(
  sandbox: DockerSandbox | LocalSandbox,
  relativePath: string,
): Promise<boolean> {
  try {
    await sandbox.access(`${sandbox.workingDirectory}/${relativePath}`);
    return true;
  } catch {
    return false;
  }
}

function detectPackageManager(scripts: Record<string, string>): "bun" | "npm" {
  const allScripts = Object.values(scripts).join(" ");
  if (allScripts.includes("bun ")) return "bun";
  return "npm";
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// --- Phase: Clone Reference Repos ---

async function cloneReferenceRepos(
  job: Job,
  sandbox: DockerSandbox | LocalSandbox,
  options: RunJobOptions,
  log: JobLogger,
): Promise<void> {
  const refs = job.referenceRepos;
  if (!refs || refs.length === 0) return;

  const stepId = await startStep(job.id, "clone_refs");
  await log.info(`Cloning ${refs.length} reference repo(s)...`);

  try {
    // Create .refs directory
    await sandbox.exec("mkdir -p .refs", sandbox.workingDirectory, 5_000);

    for (const ref of refs) {
      const dirName = `${ref.repoOwner}-${ref.repoName}`;
      const branch = ref.branch ?? "main";
      const refDir = `.refs/${dirName}`;

      await log.info(
        `Cloning reference: ${ref.repoOwner}/${ref.repoName} (${branch})`,
      );

      const cloneUrl = options.githubToken
        ? `https://x-access-token:${options.githubToken}@github.com/${ref.repoOwner}/${ref.repoName}.git`
        : `https://github.com/${ref.repoOwner}/${ref.repoName}.git`;

      const result = await sandbox.exec(
        `git clone --depth 1 --single-branch --branch ${shellEscape(branch)} ${shellEscape(cloneUrl)} ${shellEscape(refDir)}`,
        sandbox.workingDirectory,
        120_000,
      );

      if (!result.success) {
        await log.warn(
          `Failed to clone reference ${ref.repoOwner}/${ref.repoName}: ${result.stderr.slice(0, 200)}`,
        );
        // Non-fatal: continue with other refs
      }
    }

    await completeStep(stepId, "completed", {
      repoCount: refs.length,
    });
    await log.info(`Reference repos cloned into .refs/`);
  } catch (error) {
    await completeStep(stepId, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-fatal: agent can still work without refs
    await log.warn(
      `Reference repo cloning failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// --- Phase: Configure machina-cli ---

async function configureMachinaCli(
  sandbox: DockerSandbox | LocalSandbox,
  deployConfig: DeployConfig,
  machinaOrgId: string | undefined,
  machinaProjectId: string | undefined,
  log: JobLogger,
): Promise<void> {
  try {
    const apiKey = deployConfig.machinaApiKey ?? "";
    const coreApiUrl = deployConfig.coreApiUrl ?? "https://api.machina.gg";

    // Detect actual HOME directory in the sandbox
    const homeResult = await sandbox.exec("echo $HOME", "/tmp", 5_000);
    const homeDir = homeResult.stdout.trim() || "/root";
    const machinaDir = `${homeDir}/.machina`;

    // Create ~/.machina directory
    await sandbox.exec(`mkdir -p ${machinaDir}`, "/tmp", 5_000);

    // Write config.json with org/project and API URL
    const config: Record<string, string> = {
      api_url: coreApiUrl,
      output_format: "table",
    };
    if (machinaOrgId) {
      config.default_organization_id = machinaOrgId;
    }
    if (machinaProjectId) {
      config.default_project_id = machinaProjectId;
    }
    if (deployConfig.clientApiUrl) {
      config.client_api_url = deployConfig.clientApiUrl;
    }

    // Write config and credentials as proper JSON files
    const configStr = JSON.stringify(config, null, 2);
    const credentialsStr = JSON.stringify({ api_key: apiKey }, null, 2);

    await sandbox.exec(
      `printf '%s' ${shellEscape(configStr)} > ${machinaDir}/config.json`,
      "/tmp",
      5_000,
    );

    await sandbox.exec(
      `printf '%s' ${shellEscape(credentialsStr)} > ${machinaDir}/credentials.json && chmod 600 ${machinaDir}/credentials.json`,
      "/tmp",
      5_000,
    );

    // Export MACHINA_API_KEY for child processes
    await sandbox.exec(
      `echo 'export MACHINA_API_KEY=${shellEscape(apiKey)}' >> ${homeDir}/.bashrc`,
      "/tmp",
      5_000,
    );

    // Verify machina-cli is available
    const versionResult = await sandbox.exec(
      "machina version 2>/dev/null || echo 'not installed'",
      "/tmp",
      10_000,
    );
    const version = versionResult.stdout.trim();

    if (version.includes("not installed")) {
      await log.info(
        "machina-cli not available in sandbox (will use HTTP fallback)",
      );
    } else {
      await log.info(
        `machina-cli configured: ${version}, org=${machinaOrgId ?? "default"}`,
      );
    }
  } catch (error) {
    // Non-fatal: agent can work without CLI
    await log.warn(
      `machina-cli setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Returns true when `git status --porcelain` reports ANY line — tracked
 * changes, untracked files, renames. False means the agent loop made no
 * net change to the working tree.
 */
/**
 * Pull the underlying provider response out of an AI SDK thrown error.
 * Covers AI_APICallError (has statusCode + responseBody), nested cause
 * chains, and plain objects with .data.error. Returns undefined when
 * we can't extract anything useful.
 */
function extractAgentErrorDetails(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const parts: string[] = [];
  // Walk a couple of cause levels
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const rec = current as Record<string, unknown>;
    if (typeof rec.statusCode === "number") parts.push(`status=${rec.statusCode}`);
    if (typeof rec.url === "string") parts.push(`url=${rec.url}`);
    if (typeof rec.responseBody === "string" && rec.responseBody.length > 0) {
      parts.push(`body=${rec.responseBody.slice(0, 300)}`);
    }
    if (rec.data && typeof rec.data === "object") {
      const dataErr = (rec.data as Record<string, unknown>).error;
      if (dataErr) parts.push(`data.error=${JSON.stringify(dataErr).slice(0, 300)}`);
    }
    current = (rec as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

async function hasWorkingTreeChanges(
  sandbox: DockerSandbox | LocalSandbox,
  log: JobLogger,
): Promise<boolean> {
  try {
    const result = await sandbox.exec(
      "git status --porcelain",
      sandbox.workingDirectory,
      10_000,
    );
    if (!result.success) {
      // If we can't tell, err on the side of "yes, try to commit" so we
      // don't silently drop real work.
      await log.warn(
        `git status check failed (${result.stderr || "unknown"}) — assuming changes exist`,
      );
      return true;
    }
    return result.stdout.trim().length > 0;
  } catch (err) {
    await log.warn(
      `git status check threw (${err instanceof Error ? err.message : String(err)}) — assuming changes exist`,
    );
    return true;
  }
}

function buildJobUsage(
  usage: LanguageModelUsage | undefined,
  steps: number,
  modelId: string | null | undefined,
): JobUsage | undefined {
  if (!usage) return;
  const out: JobUsage = {};
  if (typeof usage.inputTokens === "number")
    out.inputTokens = usage.inputTokens;
  if (typeof usage.outputTokens === "number")
    out.outputTokens = usage.outputTokens;
  if (typeof usage.totalTokens === "number")
    out.totalTokens = usage.totalTokens;
  if (typeof usage.cachedInputTokens === "number")
    out.cachedInputTokens = usage.cachedInputTokens;
  if (typeof usage.reasoningTokens === "number")
    out.reasoningTokens = usage.reasoningTokens;
  if (steps > 0) out.steps = steps;
  if (modelId) out.modelId = modelId;
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildStudioProjectContext(job: Job): string[] {
  const ctx = job.projectContext;
  if (!ctx) return [];

  const lines: string[] = [
    "",
    "## Machina Project Context",
    `This job was created from inside the Machina Studio for project **${ctx.name}** (id \`${ctx.projectId}\`, org \`${ctx.orgId}\`).`,
  ];
  if (ctx.clientApiUrl) {
    lines.push(`Client API base URL: ${ctx.clientApiUrl}`);
  }
  const named = (
    list: Array<{ name: string; description?: string }> | undefined,
  ) =>
    list && list.length > 0
      ? list
          .slice(0, 20)
          .map((i) =>
            i.description
              ? `  - ${i.name} — ${i.description}`
              : `  - ${i.name}`,
          )
          .join("\n")
      : null;
  const connectors = named(ctx.connectors);
  if (connectors) lines.push("", "Available connectors:", connectors);
  const agents = named(ctx.agents);
  if (agents) lines.push("", "Available agents:", agents);
  const templates = named(ctx.templates);
  if (templates) lines.push("", "Available templates:", templates);
  const workflows = named(ctx.workflows);
  if (workflows) lines.push("", "Available workflows:", workflows);
  lines.push(
    "",
    "When generating code (templates, workflows, skills), ALWAYS prefer the connectors/agents listed above over generic ones — they're already configured and wired to this project.",
  );
  return lines;
}

function buildReferenceRepoContext(job: Job): string[] {
  const refs = job.referenceRepos;
  if (!refs || refs.length === 0) return [];

  const lines = [
    "",
    "## Reference Repositories",
    "The following repos have been cloned as read-only context in the .refs/ directory:",
  ];
  for (const ref of refs) {
    const dirName = `${ref.repoOwner}-${ref.repoName}`;
    lines.push(
      `- .refs/${dirName}/ (${ref.repoOwner}/${ref.repoName}, branch: ${ref.branch ?? "main"})`,
    );
  }
  lines.push(
    "Read files from these directories to understand existing patterns, structures, and code.",
    "Write all changes ONLY in the main workspace (not in .refs/).",
  );
  return lines;
}

/**
 * Extract human-readable summaries from tool calls in a model message.
 * e.g. "read → src/main.py", "edit → src/utils.ts", "bash → npm test"
 */
function extractToolSummaries(message: unknown): string[] {
  if (!message || typeof message !== "object") return [];
  const msg = message as Record<string, unknown>;
  if (msg.role !== "assistant") return [];

  // AI SDK ModelMessage stores tool calls in `content` (array of parts)
  const parts =
    (Array.isArray(msg.content) ? msg.content : null) ??
    (Array.isArray(msg.parts) ? msg.parts : null);
  if (!parts) return [];

  const summaries: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as {
      type?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      args?: Record<string, unknown>;
    };
    if (p.type !== "tool-call" || !p.toolName) continue;

    const tool = p.toolName;
    const input = p.input ?? p.args ?? {};

    const filePath = String(
      input.filePath ?? input.file_path ?? input.path ?? "",
    );

    switch (tool) {
      case "read":
        summaries.push(`read → ${filePath || "file"}`);
        break;
      case "write":
        summaries.push(`write → ${filePath || "file"}`);
        break;
      case "edit":
        summaries.push(`edit → ${filePath || "file"}`);
        break;
      case "glob":
        summaries.push(`glob → ${input.pattern ?? "*"}`);
        break;
      case "grep":
        summaries.push(
          `grep → "${String(input.pattern ?? "").slice(0, 50)}"${input.path ? ` in ${input.path}` : ""}`,
        );
        break;
      case "bash":
        summaries.push(`bash → ${String(input.command ?? "").slice(0, 100)}`);
        break;
      case "task":
        summaries.push(`task → ${String(input.task ?? "").slice(0, 80)}`);
        break;
      case "web_fetch":
        summaries.push(`fetch → ${String(input.url ?? "").slice(0, 80)}`);
        break;
      case "todo_write":
        summaries.push(`todo → updating task list`);
        break;
      case "skill":
        summaries.push(
          `skill → ${String(input.name ?? input.skill ?? "").slice(0, 60)}`,
        );
        break;
      default:
        summaries.push(`${tool} → ${JSON.stringify(input).slice(0, 80)}`);
    }
  }
  return summaries;
}

function extractToolErrors(messages: unknown[]): string[] {
  const errors: string[] = [];
  // Check last 3 messages for tool results with errors
  for (
    let i = messages.length - 1;
    i >= Math.max(0, messages.length - 3);
    i--
  ) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role !== "tool") continue;
    const content = Array.isArray(msg.content)
      ? msg.content
      : Array.isArray(msg.parts)
        ? msg.parts
        : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; toolName?: string; result?: unknown };
      if (p.type !== "tool-result" || !p.result) continue;
      const result = p.result as Record<string, unknown>;
      if (result.success === false && result.error) {
        errors.push(
          `tool error (${p.toolName ?? "?"}): ${String(result.error).slice(0, 150)}`,
        );
      }
    }
  }
  return errors;
}

async function sendCallback(
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(
      `[Callback] Failed to send to ${url}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

const clarifyingQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  why: z.string().optional(),
});

const planItemSchema = z.object({
  task: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  baseBranch: z.string(),
  origin: z.string(),
});

const planClarifySchema = z.object({
  status: z.literal("clarify"),
  questions: z.array(clarifyingQuestionSchema).min(1).max(6),
  reason: z.string().optional(),
});

const planReadySchema = z.object({
  status: z.literal("ready").optional(),
  summary: z.string(),
  items: z.array(planItemSchema),
});

export const planFileSchema = z.union([planClarifySchema, planReadySchema]);

async function extractPlanJson(
  sandbox: DockerSandbox | LocalSandbox,
  log: JobLogger,
) {
  try {
    const content = await sandbox.readFile(
      `${sandbox.workingDirectory}/PLAN.json`,
      "utf-8",
    );
    return planFileSchema.parse(JSON.parse(content));
  } catch (err) {
    await log.warn("Failed to read or parse PLAN.json: " + String(err));
    throw err;
  }
}
