import type { SandboxState } from "@machina-factory/sandbox";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Projects ---

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    machinaOrgId: text("machina_org_id").notNull(),
    machinaProjectId: text("machina_project_id").notNull(),
    githubOwner: text("github_owner"),
    githubRepo: text("github_repo"),
    defaultBranch: text("default_branch").default("main"),
    settings: jsonb("settings").$type<ProjectSettings>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("projects_machina_org_project_idx").on(
      table.machinaOrgId,
      table.machinaProjectId,
    ),
  ],
);

export interface ProjectSettings {
  modelId?: string;
  customInstructions?: string;
  deploy?: DeployConfig;
}

export interface DeployConfig {
  /** Machina API key for auth (X-Api-Token header) */
  machinaApiKey?: string;
  /** Client API base URL, e.g. https://org-project.org.machina.gg */
  clientApiUrl?: string;
  /** Core API base URL, defaults to https://api.machina.gg */
  coreApiUrl?: string;
  /** Auto-push discovered templates after job completion */
  autoPushTemplates?: boolean;
  /** Auto-trigger client-api redeploy after template push */
  autoRedeploy?: boolean;
}

/**
 * Project context forwarded from Machina Studio when a job is created
 * from within the Studio's embedded Factory surface. The agent receives a
 * rendered summary of this in its system prompt so that suggestions respect
 * the real set of connectors/agents/templates/workflows available in the
 * Machina project.
 */
export interface StudioProjectContext {
  projectId: string;
  orgId: string;
  name: string;
  clientApiUrl?: string;
  /** Origin of the Studio instance (e.g. https://studio-staging.machina.gg). */
  studioBaseUrl?: string;
  connectors?: Array<{ name: string; slug?: string; description?: string }>;
  agents?: Array<{ name: string; slug?: string; description?: string }>;
  templates?: Array<{ name: string; slug?: string; description?: string }>;
  workflows?: Array<{ name: string; slug?: string; description?: string }>;
}

/**
 * Aggregated token usage across every agent step in a single job. Mirrors the
 * shape of AI SDK's `LanguageModelUsage` (keeping the fields we actually
 * observe in practice) so we can feed the value straight from
 * `result.totalUsage` / `sumLanguageModelUsage` without a translation layer.
 */
export interface JobUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  /** Number of agent steps (stream() calls) contributing to these totals. */
  steps?: number;
  /** Last model id observed — useful for cost estimation. */
  modelId?: string;
}

// --- API Keys ---

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    name: text("name"),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("api_keys_hash_idx").on(table.keyHash)],
);

// --- Jobs ---

export const jobStatusEnum = [
  "queued",
  "paused",
  "provisioning",
  "running",
  "verifying",
  "committing",
  "deploying",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof jobStatusEnum)[number];

export const originEnum = [
  "user",
  "continuation",
  "queue_child",
  "machina_core",
  "machina_client",
  "templates",
  "other",
] as const;

export type JobOrigin = (typeof originEnum)[number];

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentJobId: text("parent_job_id").references((): any => jobs.id, {
      onDelete: "set null",
    }),
    queueId: text("queue_id"),
    queuePosition: integer("queue_position"),
    origin: text("origin", { enum: originEnum }).notNull().default("user"),
    externalId: text("external_id"),
    mode: text("mode", { enum: ["execute", "plan"] })
      .notNull()
      .default("execute"),
    status: text("status", { enum: jobStatusEnum }).notNull().default("queued"),
    task: text("task").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    baseBranch: text("base_branch").notNull(),
    workBranch: text("work_branch").notNull(),
    sandboxState: jsonb("sandbox_state").$type<SandboxState>(),
    sandboxWorkingDirectory: text("sandbox_working_directory"),
    agentMessages: jsonb("agent_messages"),
    referenceRepos: jsonb("reference_repos").$type<ReferenceRepo[]>(),
    createRepoConfig: jsonb("create_repo_config").$type<CreateRepoConfig>(),
    deployConfig: jsonb("deploy_config").$type<DeployConfig>(),
    projectContext: jsonb("project_context").$type<StudioProjectContext>(),
    usage: jsonb("usage").$type<JobUsage>(),
    modelId: text("model_id"),
    result: jsonb("result").$type<JobResult>(),
    error: text("error"),
    callbackUrl: text("callback_url"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return [
      index("jobs_project_id_idx").on(table.projectId),
      index("jobs_status_idx").on(table.status),
      index("jobs_parent_id_idx").on(table.parentJobId),
      index("jobs_queue_id_idx").on(table.queueId, table.queuePosition),
      uniqueIndex("jobs_project_external_id_idx").on(
        table.projectId,
        table.externalId,
      ),
    ];
  },
);

export interface ReferenceRepo {
  repoOwner: string;
  repoName: string;
  branch?: string;
}

export interface CreateRepoConfig {
  org: string;
  name: string;
  fromRepo: {
    repoOwner: string;
    repoName: string;
    branch?: string;
  };
  private: boolean;
  description?: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  options?: string[];
  why?: string;
}

export interface PlanItem {
  task: string;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  origin: string;
}

export interface PlanClarify {
  status: "clarify";
  questions: ClarifyingQuestion[];
  reason?: string;
}

export interface PlanReady {
  /** Optional for backward compat with legacy plans stored before this field existed. */
  status?: "ready";
  summary: string;
  items: PlanItem[];
  /** Populated when this plan job was derived from a prior clarify-round's answers. */
  answers?: Record<string, string>;
}

export type JobPlan = PlanClarify | PlanReady;

export interface JobResult {
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  verificationResults?: VerificationResult[];
  deployResults?: DeployResult[];
  plan?: JobPlan;
  /**
   * True when the agent loop finished without modifying any files.
   * Factory is a code-change surface; tasks that don't produce code
   * (e.g. "run workflow X", "inspect agent Y") hit this path and the
   * commit/push/PR/deploy phases are skipped.
   */
  noCodeChanges?: boolean;
}

export interface DeployResult {
  templatePath: string;
  pushed: boolean;
  error?: string;
}

export interface VerificationResult {
  step: string;
  passed: boolean;
  output?: string;
}

// --- Job Steps ---

export const jobStepEnum = [
  "create_repo",
  "clone",
  "clone_refs",
  "agent_loop",
  "verify_tests",
  "verify_lint",
  "verify_build",
  "verify_typecheck",
  "commit",
  "push",
  "create_pr",
  "deploy_templates",
  "deploy_trigger",
] as const;

export type JobStepType = (typeof jobStepEnum)[number];

export const jobStepStatusEnum = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type JobStepStatus = (typeof jobStepStatusEnum)[number];

export const jobSteps = pgTable(
  "job_steps",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    step: text("step", { enum: jobStepEnum }).notNull(),
    status: text("status", { enum: jobStepStatusEnum })
      .notNull()
      .default("pending"),
    output: jsonb("output"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
  },
  (table) => [index("job_steps_job_id_idx").on(table.jobId)],
);

// --- Job Logs ---

export const jobLogLevelEnum = ["info", "warn", "error", "debug"] as const;

export type JobLogLevel = (typeof jobLogLevelEnum)[number];

export const jobLogs = pgTable(
  "job_logs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    level: text("level", { enum: jobLogLevelEnum }).notNull().default("info"),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("job_logs_job_id_created_idx").on(table.jobId, table.createdAt),
  ],
);

// --- GitHub Installations (kept from original, adapted for project scope) ---

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: ["User", "Organization"],
    }).notNull(),
    repositorySelection: text("repository_selection", {
      enum: ["all", "selected"],
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_installations_project_installation_idx").on(
      table.projectId,
      table.installationId,
    ),
  ],
);

// --- Type exports ---

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobStep = typeof jobSteps.$inferSelect;
export type NewJobStep = typeof jobSteps.$inferInsert;
export type JobLog = typeof jobLogs.$inferSelect;
export type NewJobLog = typeof jobLogs.$inferInsert;
export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallations.$inferInsert;
