# Machina Runtime Patterns

Hard-won knowledge about how the Machina client-api workflow runtime works. These patterns are **critical** when creating agent templates, workflows, connectors, and prompts.

## Workflow Commands

The `connector.command` field uses `method-path` format, NOT OpenAPI `operationId`.

```yaml
# CORRECT — runtime splits on first "-" to get HTTP method + path
connector:
  name: spotify-podcasts
  command: get-search           # → GET /search
  
connector:
  name: grok
  command: post-chat/completions  # → POST /chat/completions

# WRONG — operationId is not recognized
connector:
  name: spotify-podcasts
  command: searchPodcasts     # → method=SEARCHPODCASTS, path=/ (broken!)
```

The runtime code (`run_connector` in `connector.py`) does:
```python
parts = api_endpoint.split("-")
method = parts[0].upper()
path = f"/{'-'.join(parts[1:])}"
```

## Literal String Inputs

ALL workflow task inputs are evaluated with Python `eval()`. Bare strings cause `NameError` and fall back to empty array `[]`.

```yaml
# CORRECT — inner quotes make it a Python string literal
inputs:
  type: "'show'"         # eval("'show'") → "show"
  market: "'US'"         # eval("'US'") → "US"
  limit: 3               # numbers work as-is

# WRONG — eval treats these as Python variable names
inputs:
  type: "show"           # eval("show") → NameError → falls back to []
  market: "US"           # eval("US") → NameError → falls back to []
```

Dynamic values use `$.get()`:
```yaml
inputs:
  query: "$.get('query')"                          # reads from workflow context
  show_id: "$.get('show', {}).get('id')"           # nested access
  combined: "$.get('query') + ' podcast'"          # string concatenation
```

## Output Expressions

Outputs are also `eval()`'d. The `$` symbol is replaced:
- In **outputs**: `$.get` → `response.get` (response = connector return data)
- In **inputs/conditions**: `$.get` → `context.get` (context = workflow state)

```yaml
outputs:
  shows: "$.get('shows', {}).get('items', [])"     # parse connector response
  digest: "$.get('content', '')"                    # get generated content

# Available in eval namespace: json, datetime, random, timedelta, context, response, totals
# json.loads() IS available but usually not needed (REST responses are parsed)
```

**Error fallback**: If an output expression fails, the value becomes `"Error: {message}"` (string).

## Foreach Loops

```yaml
- name: fetch-episodes
  type: connector
  connector:
    name: spotify-podcasts
    command: get-shows
  condition: "len($.get('shows', [])) > 0"
  foreach:
    name: show                    # loop variable name
    value: "$.get('shows', [])"   # iterable
    expr: "$"                     # expression context
    concurrent: true              # run in parallel
  inputs:
    show_id: "$.get('show', {}).get('id')"   # access loop item
  outputs:
    episodes: "[\n  *$.get('items', [])\n]\n"  # accumulate results
```

## Bearer Token Authentication (REST Connectors)

The runtime only recognizes `basicAuth` as the security scheme name for Bearer tokens. Other names like `bearer`, `bearerAuth`, etc. are **silently ignored**.

### Connector JSON Schema
```json
{
  "components": {
    "securitySchemes": {
      "basicAuth": {
        "type": "http",
        "scheme": "Bearer"
      }
    }
  },
  "paths": {
    "/search": {
      "get": {
        "security": [{"basicAuth": []}],
        ...
      }
    }
  }
}
```

The runtime code does:
```python
if scheme_name == "basicAuth" and scheme_details.get("scheme") == "Bearer":
    headers["Authorization"] = f"Bearer {request_headers.get('basicAuth')}"
```

### Workflow context-variables
```yaml
context-variables:
  my-connector:
    basicAuth: "$TEMP_CONTEXT_VARIABLE_MY_API_KEY"
```

## Vault Secret Naming

The `$` prefix is stripped, and the rest is used as an **exact MongoDB lookup** on the vault `name` field.

```yaml
# In workflow YAML
context-variables:
  spotify-podcasts:
    basicAuth: "$TEMP_CONTEXT_VARIABLE_SPOTIFY_BEARER_TOKEN"

# Vault entry must have EXACTLY this name:
# name: "TEMP_CONTEXT_VARIABLE_SPOTIFY_BEARER_TOKEN"
```

Common vault key patterns:
- `TEMP_CONTEXT_VARIABLE_SDK_OPENAI_API_KEY` — OpenAI
- `TEMP_CONTEXT_VARIABLE_GOOGLE_GENERATIVE_AI_API_KEY` — Google AI
- `TEMP_CONTEXT_VARIABLE_VERTEX_AI_CREDENTIAL` — Vertex AI credential
- `TEMP_CONTEXT_VARIABLE_VERTEX_AI_PROJECT_ID` — Vertex AI project

## Google Gemini / Vertex AI

Working configuration for google-genai connector:

```yaml
context-variables:
  google-genai:
    api_key: "$TEMP_CONTEXT_VARIABLE_GOOGLE_GENERATIVE_AI_API_KEY"
    credential: "$TEMP_CONTEXT_VARIABLE_VERTEX_AI_CREDENTIAL"
    project_id: "$TEMP_CONTEXT_VARIABLE_VERTEX_AI_PROJECT_ID"

tasks:
  - name: generate-content
    type: prompt
    connector:
      name: google-genai
      command: invoke_prompt
      model: gemini-2.5-flash
      provider: vertex_ai        # REQUIRED
      location: global            # REQUIRED
    inputs:
      query: "$.get('query')"
    outputs:
      content: "$.get('content', '')"
```

Without `provider: vertex_ai` and `location: global`, the connector fails silently.

## OpenAI / machina-ai

```yaml
context-variables:
  machina-ai:
    api_key: "$TEMP_CONTEXT_VARIABLE_SDK_OPENAI_API_KEY"

tasks:
  - name: generate
    type: prompt
    connector:
      name: machina-ai
      command: invoke_prompt
      model: gpt-4o
    inputs:
      query: "$.get('query')"
    outputs:
      content: "$.get('content', '')"
```

## workflow-status Output (Required)

Every workflow MUST have `workflow-status` in its outputs. Without it, the runtime returns `400 Property outputs must contain 'workflow-status' definition`.

```yaml
outputs:
  result: "$.get('result', '')"
  workflow-status: "$.get('result', '') != ''"    # evaluates to True/False
```

## Path Parameters (Not Supported)

The runtime does NOT properly substitute `{param}` in URL paths from task inputs. Path parameters are stored in `path_attribute` which is not populated from inputs.

**Workaround**: Use query parameters instead, or flatten the endpoint.

```yaml
# WRONG — {show_id} won't be substituted
connector:
  command: get-shows/{show_id}/episodes

# WORKAROUND — use query param if the API supports it
connector:
  command: get-shows
inputs:
  ids: "$.get('show_id')"
```

## Prompt Template Variables

Prompt `instructions` use `{variable_name}` placeholders. The variable names MUST match the task input names exactly.

```yaml
# Prompt YAML
prompt:
  name: generate-digest
  instructions: |
    Generate a digest about {query} based on this data:
    {shows_data}

# Workflow task inputs must match placeholder names
tasks:
  - name: generate
    type: prompt
    inputs:
      query: "$.get('query')"           # matches {query}
      shows_data: "$.get('shows', [])"  # matches {shows_data}
```

## _install.yml Dataset Types

```yaml
datasets:
  - type: agent          # root key: agent (singular)
  - type: connector      # root key: connector (singular)
  - type: workflow       # root key: workflow (singular)
  - type: prompt         # root key: prompt (singular, ONE prompt)
  - type: prompts        # root key: prompts (plural, ARRAY of prompts)
  - type: document       # root key: document (singular)
  - type: documents      # root key: documents (plural, ARRAY)
  - type: mappings       # root key: mappings (plural, ARRAY)
  - type: skill          # root key: skill (singular)
```

Mismatch between type and root key causes `Failed to import dataset` errors.

## Agent/Workflow Execution Endpoints

```
# Synchronous (waits for result, returns data)
POST /workflow/execute/{name}    → returns {data: {outputs: {...}}}

# Asynchronous (returns immediately, fires Celery task)
POST /workflow/schedule/{name}   → returns {data: {workflow_run_id: "..."}}
POST /agent/executor/{name}      → returns empty (fires Celery task)

# Streaming (SSE)
POST /agent/stream/{name}        → SSE stream with real-time updates
```

For frontends, use `/workflow/execute/` (sync) to get results directly. The `/agent/executor/` endpoint returns an empty response and runs in background.

## Connector Response Format

REST connector responses flow through: `connector_request()` → `connector_execute()` → `run_connector()` → `_save_outputs()`.

When the HTTP response has `Content-Type: application/json` and status 2xx, the JSON is parsed into a dict. Otherwise, `response.text` (raw string) is returned. String responses cause `'str' object has no attribute 'get'` in output expressions.

Common causes of string responses:
- Auth failure → API returns HTML error page
- Wrong Content-Type header
- Empty response body

## Context Variables Flow

```
workflow.context-variables → task_context["headers"] → connector_config["headers"]
→ request_data["headers"] → server_params → resolve_schema() → HTTP headers
```

For each connector name match in context-variables:
- If value starts with `$`: calls `get_integration_secret(value[1:])` (vault lookup)
- Otherwise: uses the value as-is

The key name becomes the HTTP header name (except `basicAuth` which is transformed to `Authorization: Bearer {value}`).
