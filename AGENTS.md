# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

## Quick Links

- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)

## What is Machina Factory?

Machina Factory is an API-first coding agent runtime. It takes a repo, branch, and task description, and produces code changes, verification results, and pull requests.

Architecture:
```
API (Hono) -> Job Queue (PostgreSQL) -> Worker -> Docker Sandbox -> Agent (AI SDK)
                                                        |
                                                  GitHub (commit, push, PR)
```

## Database & Migrations

Schema lives in `apps/api/src/lib/db/schema.ts`. Migrations are managed by Drizzle Kit.

**After modifying `schema.ts`, always generate a migration:**

```bash
bun run db:generate   # Creates a new .sql migration file
```

Commit the generated `.sql` file alongside the schema change. **Do not use `db:push`** except for local throwaway databases.

## Commands

```bash
# Development
bun run dev            # Start API server (hot reload)
bun run worker         # Start job worker

# Quality checks (REQUIRED after making any changes)
bun run ci                                 # Required: run format check, lint, typecheck, and tests
turbo typecheck                            # Type check all packages

# Linting and formatting (Ultracite - oxlint + oxfmt, run from root)
bun run check                              # Lint and format check all files
bun run fix                                # Lint fix and format all files

# Filter by package (use --filter)
turbo typecheck --filter=api               # Type check API only

# Testing
bun test                                   # Run all tests
bun test path/to/file.test.ts              # Run single test file
bun run test:verbose                       # Run tests with verbose output

# Database
bun run db:generate                        # Generate migration from schema changes
bun run db:migrate                         # Apply pending migrations

# Docker
bun run docker:build-sandbox               # Build sandbox base image
```

**CI/script execution rules:**

- Run project checks through package scripts (for example `bun run ci`).
- Prefer `bun run <script>` over invoking tool binaries directly.

## Git Commands

- **Branch sync preference:** When bringing in `origin/main`, prefer a normal merge instead of rebasing.

## Architecture

```
machina-factory/
  apps/
    api/              -- Hono API server + job worker
  packages/
    agent/            -- AI coding agent (tools, subagents, system prompt)
    sandbox/          -- Sandbox abstraction (Docker + Vercel implementations)
    shared/           -- Shared utilities
    tsconfig/         -- Shared TypeScript configs
```

### Key packages:
- **@machina-factory/agent** -- Coding agent with 12 tools, 3 subagent types, skills system
- **@machina-factory/sandbox** -- Sandbox interface with Docker container implementation
- **@machina-factory/shared** -- Shared diff utilities and tool state helpers

### Data Model:
- **projects** -- Machina org/project registration
- **api_keys** -- Project-scoped API authentication
- **jobs** -- Core work unit (queued -> running -> completed)
- **job_steps** -- Execution step tracking
- **job_logs** -- Append-only log stream

## File Organization & Separation of Concerns

- Do **not** append new functionality to the bottom of an existing file by default.
- Before adding code, decide whether the behavior is a separate concern that should live in its own file.
- Prefer creating a new colocated file for distinct concerns.
- Keep each file focused on one primary responsibility.

## Code Style (Summary)

- **Bun exclusively** (not Node/npm/pnpm)
- **Files**: kebab-case, **Types**: PascalCase, **Functions**: camelCase
- **Never use `any`** -- use `unknown` and narrow with type guards
- **No `.js` extensions** in imports
- **Ultracite** (oxlint + oxfmt) for linting and formatting (double quotes, 2-space indent)
- **Zod** schemas for validation, derive types with `z.infer`

See [Code Style & Patterns](docs/agents/code-style.md) for full conventions.
