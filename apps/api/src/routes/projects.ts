import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { generateApiKey } from "../lib/auth/api-key";
import { db } from "../lib/db/client";
import { projects } from "../lib/db/schema";
import type { ProjectSettings } from "../lib/db/schema";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

const deployConfigSchema = z.object({
  machinaApiKey: z.string().optional(),
  clientApiUrl: z.string().url().optional().or(z.literal("")),
  coreApiUrl: z.string().url().optional().or(z.literal("")),
  autoPushTemplates: z.boolean().optional(),
  autoRedeploy: z.boolean().optional(),
});

const updateProjectSettingsSchema = z.object({
  modelId: z.string().optional(),
  customInstructions: z.string().optional(),
  deploy: deployConfigSchema.optional(),
});

const createProjectSchema = z.object({
  machinaOrgId: z.string().min(1),
  machinaProjectId: z.string().min(1),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  defaultBranch: z.string().optional(),
  settings: z
    .object({
      modelId: z.string().optional(),
      customInstructions: z.string().optional(),
    })
    .optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createProjectSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      400,
    );
  }

  const { machinaOrgId, machinaProjectId, ...rest } = parsed.data;
  const id = nanoid();

  // Check for existing project (use select instead of relational query for neon-http compat)
  const existingRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.machinaOrgId, machinaOrgId),
        eq(projects.machinaProjectId, machinaProjectId),
      ),
    )
    .limit(1);

  if (existingRows.length > 0) {
    return c.json(
      {
        error: "Project already registered",
        projectId: existingRows[0]!.id,
      },
      409,
    );
  }

  await db
    .insert(projects)
    .values({
      id,
      machinaOrgId,
      machinaProjectId,
      ...rest,
    })
    .returning({ id: projects.id });

  const { key, prefix } = await generateApiKey(id, "default");

  return c.json(
    {
      id,
      machinaOrgId,
      machinaProjectId,
      apiKey: key,
      apiKeyPrefix: prefix,
    },
    201,
  );
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(rows[0]);
});

app.post("/:id/settings", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");

  // Ensure the authenticated project matches the target project
  if (projectId !== id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json();
  const parsed = updateProjectSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      400,
    );
  }

  // Fetch current settings to merge
  const rows = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Project not found" }, 404);
  }

  const currentSettings = (rows[0]!.settings ?? {}) as ProjectSettings;
  const incoming = parsed.data;

  // Deep merge: project-level fields + nested deploy config
  const merged: ProjectSettings = {
    ...currentSettings,
    ...(incoming.modelId !== undefined && { modelId: incoming.modelId }),
    ...(incoming.customInstructions !== undefined && {
      customInstructions: incoming.customInstructions,
    }),
  };

  if (incoming.deploy) {
    // Clean empty strings to undefined (so they don't persist as "")
    const cleanDeploy = { ...incoming.deploy };
    if (cleanDeploy.clientApiUrl === "") cleanDeploy.clientApiUrl = undefined;
    if (cleanDeploy.coreApiUrl === "") cleanDeploy.coreApiUrl = undefined;

    merged.deploy = {
      ...currentSettings.deploy,
      ...cleanDeploy,
    };
  }

  await db
    .update(projects)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(projects.id, id));

  return c.json({ settings: merged });
});

// Test machina-cli connection by verifying the API key against the client-api
app.post("/:id/test-connection", async (c) => {
  const projectId = c.get("projectId");
  const id = c.req.param("id");

  if (projectId !== id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json();
  const { clientApiUrl, machinaApiKey } = body as {
    clientApiUrl?: string;
    machinaApiKey?: string;
  };

  if (!clientApiUrl || !machinaApiKey) {
    return c.json(
      { error: "clientApiUrl and machinaApiKey are required" },
      400,
    );
  }

  try {
    // Try to hit the client-api health or a lightweight endpoint
    const url = clientApiUrl.replace(/\/$/, "");
    const res = await fetch(`${url}/v1/resources`, {
      method: "GET",
      headers: {
        "X-Api-Token": machinaApiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      return c.json({ success: true, status: res.status });
    }

    const text = await res.text().catch(() => "");
    return c.json({
      success: false,
      status: res.status,
      error: text || `HTTP ${res.status}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return c.json({ success: false, error: message });
  }
});

export default app;
