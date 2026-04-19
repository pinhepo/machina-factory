# Machina Factory

API-first coding agent runtime for [Machina](https://machina.gg). Takes a repo, branch, and task -- produces code changes, verification results, and pull requests.

## Architecture

```
API Request -> Hono Server -> Job Queue (PostgreSQL)
                                  |
                              Job Worker -> Docker Sandbox -> Coding Agent
                                  |
                              GitHub (commit, push, PR)
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.2
- [Docker](https://docker.com)
- PostgreSQL 16+
- GitHub App credentials
- Anthropic API key

### Setup

```bash
# Install dependencies
bun install

# Copy environment config
cp .env.example .env
# Edit .env with your credentials

# Build the sandbox base image
bun run docker:build-sandbox

# Start PostgreSQL (or use docker compose)
docker compose up postgres -d

# Run database migrations
bun run db:migrate

# Start the API server
bun run dev

# In another terminal, start the job worker
bun run worker
```

### Docker Compose (full stack)

```bash
docker compose up
```

## API

All `/v1/*` endpoints require authentication: `Authorization: Bearer mf_...`

### Register a project

```bash
curl -X POST http://localhost:3000/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"machinaOrgId": "org_123", "machinaProjectId": "proj_456"}'
```

Returns a project ID and API key.

### Create a coding job

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Authorization: Bearer mf_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Add input validation to the login form",
    "repoOwner": "your-org",
    "repoName": "your-repo",
    "baseBranch": "main"
  }'
```

### Check job status

```bash
curl http://localhost:3000/v1/jobs/{jobId} \
  -H "Authorization: Bearer mf_your_api_key"
```

### View job logs

```bash
curl http://localhost:3000/v1/jobs/{jobId}/logs \
  -H "Authorization: Bearer mf_your_api_key"
```

## Development

```bash
bun run dev          # API server with hot reload
bun run worker       # Job worker
bun run ci           # Lint + typecheck + tests
turbo typecheck      # Type check all packages
bun run check        # Lint check
bun run fix          # Auto-fix lint/format
```

## License

[MIT](LICENSE.md)
# machina-factory
