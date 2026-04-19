# Factory Prompt Examples

A comprehensive guide to writing effective prompts for Machina Factory jobs. Each example includes the task description and recommended configuration.

---

## Table of Contents

- [Agent Templates](#agent-templates)
- [Workflow & Connector Development](#workflow--connector-development)
- [Frontend & UI](#frontend--ui)
- [Template Fixes & Iteration](#template-fixes--iteration)
- [machina-cli Operations](#machina-cli-operations)
- [Code Quality & Refactoring](#code-quality--refactoring)
- [Documentation & Knowledge Base](#documentation--knowledge-base)
- [Testing & Verification](#testing--verification)
- [Multi-Repo & Reference Repos](#multi-repo--reference-repos)
- [Platform Operations](#platform-operations)
- [Tips for Writing Great Prompts](#tips-for-writing-great-prompts)

---

## Agent Templates

### Create a complete agent template from scratch

```
Create a new agent template called "match-previewer" in the agent-templates/ directory.

## What it does
This agent generates pre-match preview content for football (soccer) matches. Given a match ID from api-football, it fetches team stats, recent form, head-to-head history, and generates a rich preview article.

## Connector
Create a REST connector called "api-football-stats" that calls the API-Football v3 API:
- Base URL: https://v3.football.api-sports.com
- Auth: x-apisports-key header from vault
- Endpoints: GET /fixtures (by id), GET /fixtures/headtohead, GET /teams/statistics

## Workflow
Create "match-preview-workflow" with steps:
1. fetch-fixture — get match details
2. fetch-h2h — get head-to-head history
3. fetch-home-stats — get home team season stats
4. fetch-away-stats — get away team season stats
5. generate-preview — use google-genai to write the preview article

## Important Machina patterns
- Workflow commands use method-path format: get-fixtures, get-fixtures/headtohead
- Literal string inputs need inner quotes: "'show'" not "show"
- context-variables map vault secrets: api_key: "$TEMP_CONTEXT_VARIABLE_API_FOOTBALL_KEY"
- workflow-status is required in outputs
- Bearer auth uses basicAuth scheme name in the connector schema

## Template structure
Follow _install.yml patterns from .refs/ reference repos.
```

**Config:**
- Repo: `machina-sports/sports-skills`
- Reference repos: `machina-sports/machina-templates`
- Model: `google/gemini-3.1-pro-preview`

---

### Create a social media content agent

```
Create an agent template called "social-media-poster" in agent-templates/.

The agent takes a sports topic and generates ready-to-post social media content for Twitter/X, Instagram, and LinkedIn.

## Flow
1. search-news — Use google-genai invoke_search to find recent news on the topic
2. generate-posts — Use google-genai invoke_prompt to generate platform-specific posts
3. generate-image — Use google-genai to create an image prompt for the post visual

## Inputs
- topic: The sports topic (e.g., "Champions League semifinal results")
- platforms: Which platforms to generate for (default: all)

## Outputs
- posts: Array of {platform, text, hashtags}
- image_prompt: A DALL-E/Imagen prompt for the visual
- workflow-status

Study the social-media-generator template in .refs/ for patterns.
```

---

### Create a data pipeline agent

```
Create an agent template called "stats-pipeline" in agent-templates/.

This agent fetches sports statistics from an API, transforms them using mappings, and stores the results as documents in the Machina knowledge base.

## Steps
1. fetch-data — REST connector to pull raw stats
2. transform-data — Use a pyscript connector to clean and normalize
3. store-results — Use the document API to save as knowledge docs

Include a pyscript connector (Python script type) for the transformation step.
Follow the adapters-dataset-pipeline template in .refs/ as reference.
```

---

## Workflow & Connector Development

### Create a REST API connector

```
Create a new REST API connector for the Spotify Web API in agent-templates/spotify-agent/connectors/.

## Connector spec
- Name: spotify-api
- Base URL: https://api.spotify.com/v1
- Auth: Bearer token via basicAuth scheme (Machina pattern for Bearer auth)
- filetype: restapi

## Endpoints (OpenAPI 3.0.3)
1. GET /search — Search for shows, episodes, tracks
   Params: q (query), type (query), market (query), limit (query)
2. GET /shows/{show_id}/episodes — Get show episodes
   Params: show_id (path), market (query), limit (query)

## Important
- securitySchemes must use "basicAuth" as the key name (not "bearer")
- scheme must be "Bearer" (capital B)
- All endpoints need security: [{"basicAuth": []}]

Create both the YAML descriptor and the JSON schema file.
```

---

### Create a Python script connector

```
Create a pyscript connector called "data-transformer" in agent-templates/stats-pipeline/connectors/.

The connector receives raw JSON data and returns cleaned, normalized output.

## Python script requirements
- Function: transform(input_data, context)
- Normalize team names to lowercase
- Convert date strings to ISO 8601
- Calculate derived stats (win rate, goals per game)
- Return {status: True, data: transformed_data}

Create the YAML descriptor and the Python script file.
Follow pyscript connector patterns from .refs/machina-templates/connectors/.
```

---

### Fix a workflow that fails at runtime

```
Fix the workflow at agent-templates/my-agent/workflows/main-workflow.yml.

The workflow fails with error: "'str' object has no attribute 'get'"

## Root cause analysis
This error means the REST connector response is being returned as a string instead of a parsed dict. Common causes:
1. Bearer auth not reaching the API (check basicAuth scheme name)
2. Literal string inputs not quoted (use "'value'" not "value")
3. json.loads() in outputs (not supported — use simple $.get())

## What to check
1. context-variables: vault key names must match exactly
2. connector command format: must be method-path (e.g., get-search, post-chat/completions)
3. task inputs: literal strings need inner quotes
4. task outputs: only $.get() expressions, no json.loads()

Fix only what's broken. Do not rewrite the entire file.
```

---

## Frontend & UI

### Create a frontend app from boilerplate

```
Create a Next.js frontend for the podcast-digest agent.

## Setup
1. Copy the frontend boilerplate from .refs/machina-sports-machina-frontend-boilerplate/
2. Customize for the podcast digest use case

## Pages
- Home page: Search input for podcast topic, "Generate Digest" button
- Results page: Display the generated digest in formatted Markdown
- History page: List of previous digests

## API Integration
- POST /api/digest — calls the Machina client-api agent executor
- GET /api/history — fetches recent executions

## Design
- Use the Machina brand colors (#fe591f primary)
- Dark mode support
- Mobile responsive
- Loading states with skeleton UI

The frontend should be in a separate directory: frontend-podcast-digest/
```

---

### Add a feature to an existing frontend

```
Add real-time execution tracking to the frontend in frontend-podcast-digest/.

When the user triggers a digest generation:
1. Show a progress stepper (Searching → Analyzing → Generating)
2. Poll the execution status every 2 seconds via GET /api/status/:id
3. Stream the result as it becomes available
4. Show error states with retry button

Use React hooks (useState, useEffect) and the existing design system.
Do not modify the API routes — only update the UI components.
```

---

## Template Fixes & Iteration

### Fix a deploy error

```
Fix the deploy error in agent-templates/my-template.

The _install.yml uses type: "prompts" (plural) for the prompt dataset, but the YAML file has root key "prompt:" (singular, one prompt).

Change the _install.yml entry from type: "prompts" to type: "prompt" to match the actual file format.

Only change this one line — do not modify anything else.
```

---

### Update workflow outputs

```
Fix agent-templates/my-agent/workflows/main-workflow.yml.

The Machina platform requires a "workflow-status" key in the outputs section. Add this line to the outputs:

  workflow-status: "$.get('result', '') != ''"

Also verify the agent YAML outputs section includes workflow-status.
Only change what is needed.
```

---

### Switch AI provider in a workflow

```
Update agent-templates/my-agent/workflows/main-workflow.yml to use Google Gemini instead of OpenAI.

Change the generate step from:
  connector:
    name: machina-ai
    command: invoke_prompt
    model: gpt-4o

To:
  connector:
    name: google-genai
    command: invoke_prompt
    model: gemini-2.5-flash
    provider: vertex_ai
    location: global

Also update context-variables to include google-genai credentials:
  google-genai:
    api_key: "$TEMP_CONTEXT_VARIABLE_GOOGLE_GENERATIVE_AI_API_KEY"
    credential: "$TEMP_CONTEXT_VARIABLE_VERTEX_AI_CREDENTIAL"
    project_id: "$TEMP_CONTEXT_VARIABLE_VERTEX_AI_PROJECT_ID"

Only change the AI provider configuration — do not modify the workflow logic.
```

---

## machina-cli Operations

### List and execute agents via CLI

```
Use machina-cli to interact with the Machina platform. Redirect stdin from /dev/null on ALL machina commands.

1. `machina agent list < /dev/null` — list available agents
2. `machina agent get podcast-digest-agent < /dev/null` — show agent details
3. `machina agent run podcast-digest-agent query="NBA playoffs" --sync --json < /dev/null` — execute the agent
4. `machina workflow list < /dev/null` — list workflows

Write all outputs to CLI-RESULTS.md. Do NOT modify any other files.
```

---

### Push a template and verify installation

```
Use machina-cli to push a template and verify it was installed.

1. `machina version < /dev/null`
2. `machina template push agent-templates/my-agent < /dev/null` — push the template
3. `machina agent list --json < /dev/null` — verify agent was created
4. `machina workflow list --json < /dev/null` — verify workflow was created
5. `machina connector list --json < /dev/null` — verify connector was created

Write results to DEPLOY-RESULTS.md.
```

---

### Run a workflow with parameters

```
Execute the social-media-generate-content workflow via machina-cli.

`machina workflow run social-media-generate-content event_id="1234567" --sync --json < /dev/null`

Save the output to EXECUTION-RESULTS.md with the full JSON response.
```

---

## Code Quality & Refactoring

### Refactor a Python package

```
Refactor the sports_skills Python package in src/sports_skills/.

1. Split the monolithic __init__.py into separate modules per sport
2. Create src/sports_skills/football/, basketball/, tennis/ directories
3. Move relevant functions to each module
4. Update imports in all files that use the package
5. Ensure all existing tests still pass

Keep backward compatibility — the old import paths should still work.
```

---

### Add type hints to a Python project

```
Add comprehensive type hints to all Python files in src/sports_skills/.

- Use typing module for complex types (List, Dict, Optional, Union)
- Add return type annotations to all functions
- Add parameter type annotations to all functions
- Use TypedDict for known dictionary structures
- Add py.typed marker file

Do NOT change any logic — only add type annotations.
```

---

### Fix linting issues

```
Run linting and fix all issues in the agent-templates/ directory.

1. Run `ruff check agent-templates/ --fix` if ruff is available
2. Otherwise manually fix: unused imports, trailing whitespace, missing newlines
3. Verify YAML files are valid with proper indentation
4. Check _install.yml references match actual file paths

Only fix formatting/linting — do not change functionality.
```

---

## Documentation & Knowledge Base

### Create comprehensive README

```
Create a detailed README.md for the sports-podcast-digest agent template.

Include:
1. Overview — what the agent does
2. Architecture diagram (text/mermaid)
3. Prerequisites — required vault secrets, API keys
4. Installation — machina template push command
5. Usage — example machina agent run commands with sample inputs
6. Configuration — available parameters and defaults
7. Workflow steps — what each step does
8. Troubleshooting — common errors and fixes

Write in clear, professional English. Use code blocks for commands.
```

---

### Generate API documentation

```
Create API-REFERENCE.md documenting all endpoints used by the template connectors.

For each connector in agent-templates/my-agent/connectors/:
1. Read the JSON schema file
2. Document each endpoint: method, path, parameters, auth, example request/response
3. Include curl examples

Format as a clean Markdown reference doc.
```

---

### Create a knowledge document for the agent

```
Create a knowledge document at agent-templates/my-agent/knowledge/rules.md.

This document will be loaded into the agent's context as reference material.

Include:
- Sports terminology glossary
- Data format conventions (date formats, ID patterns)
- Content style guide (tone, length, formatting rules)
- Common error patterns and how to handle them

Also create the YAML descriptor: knowledge/rules.yml with:
  document:
    name: agent-rules
    title: Agent Rules and Guidelines
    filename: rules.md
    filetype: markdown

Add it to _install.yml as type: document.
```

---

## Testing & Verification

### Run tests and fix failures

```
Run the test suite and fix any failures.

1. `bun test` or `npm test` — run all tests
2. If tests fail, analyze the error messages
3. Fix the root cause (not just the test)
4. Re-run to verify the fix
5. If no test framework exists, create basic tests for the main functions

Report results in TEST-RESULTS.md.
```

---

### Validate template before deploy

```
Validate the agent template at agent-templates/my-agent/ before deploying.

Check:
1. _install.yml has required fields: setup (title, description, value, version) and datasets
2. All paths in datasets actually exist
3. YAML files are valid and parseable
4. Connector JSON schemas are valid OpenAPI 3.0
5. Workflow outputs include workflow-status
6. Context-variables reference valid vault key patterns
7. No hardcoded secrets or tokens in any file

Create VALIDATION-REPORT.md with pass/fail for each check.
```

---

## Multi-Repo & Reference Repos

### Create a template using patterns from multiple repos

```
Create agent-templates/newsletter-generator based on patterns from the reference repos.

Study:
- .refs/machina-sports-machina-templates/ — for _install.yml, connector, and workflow patterns
- .refs/machina-sports-machina-frontend-boilerplate/ — for frontend structure
- .refs/machina-sports-sports-skills/ — for Python data processing patterns

The template should combine:
1. A REST connector for a news API (from machina-templates patterns)
2. A pyscript connector for content processing (from sports-skills patterns)
3. A workflow that chains them together
4. An agent that exposes the workflow

Follow the exact YAML structure from each reference repo.
```

**Config:**
```json
{
  "referenceRepos": [
    {"repoOwner": "machina-sports", "repoName": "machina-templates"},
    {"repoOwner": "machina-sports", "repoName": "machina-frontend-boilerplate"},
    {"repoOwner": "machina-sports", "repoName": "sports-skills"}
  ]
}
```

---

### Port a template from one repo to another

```
Port the "roast-agent" template from .refs/machina-sports-machina-templates/agent-templates/roast-agent/ to this repo.

1. Copy the template directory structure
2. Adapt any references to match this repo's conventions
3. Update the _install.yml with correct paths
4. Verify all YAML files are valid

Do NOT modify the original in .refs/ — only create the copy in agent-templates/.
```

---

## Platform Operations

### Deploy and verify a template

```
After creating the template, verify it deploys correctly.

1. Check that _install.yml is valid
2. Use machina-cli to push: `machina template push agent-templates/my-agent < /dev/null`
3. Verify resources: `machina agent list --json < /dev/null`
4. Run a test execution: `machina agent run my-agent query="test" --sync --json < /dev/null`

Document all results in DEPLOY-LOG.md.
```

---

### Inspect and debug a running agent

```
Debug the podcast-digest-agent that is returning empty results.

1. `machina agent get podcast-digest-agent --json < /dev/null` — check agent config
2. `machina workflow get podcast-digest-workflow --json < /dev/null` — check workflow steps
3. `machina connector list --json < /dev/null` — verify connectors exist
4. `machina execution list --json < /dev/null` — check recent executions
5. Run the agent: `machina agent run podcast-digest-agent query="test" --sync --json < /dev/null`

Analyze the execution output and workflow-error field. Write a diagnosis in DEBUG-REPORT.md.
```

---

## Tips for Writing Great Prompts

### Be specific about Machina patterns

The Factory agent knows Machina deeply, but explicit reminders prevent errors:

```
## Important Machina patterns
- Workflow commands: method-path format (get-search, post-chat/completions)
- Literal inputs: inner quotes ("'value'")  
- Bearer auth: basicAuth scheme name in connector schema
- Vault secrets: $TEMP_CONTEXT_VARIABLE_{KEY_NAME}
- Required output: workflow-status
- Google AI: provider: vertex_ai, location: global
```

### Use reference repos

Always include reference repos when creating templates:

```json
{
  "referenceRepos": [
    {"repoOwner": "machina-sports", "repoName": "machina-templates"}
  ]
}
```

### Keep changes minimal for fixes

For bug fixes, be very specific:

```
Change line X from Y to Z. Do not modify anything else.
```

### Use machina-cli with /dev/null

All CLI commands need stdin redirect to avoid interactive mode:

```
machina agent list < /dev/null
machina workflow run my-workflow key=value --sync --json < /dev/null
```

### Continue jobs for iteration

Use the same `workBranch` as `baseBranch` to continue from a previous job's changes:

```json
{
  "baseBranch": "machina/abc123",
  "workBranch": "machina/abc123"
}
```

### Deploy pipeline auto-pushes templates

When `autoPushTemplates` is enabled in project settings, Factory automatically discovers `_install.yml` files in the workspace and pushes them to the Machina platform after creating the PR. No manual `machina template push` needed.
