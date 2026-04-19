import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { generateApiKey } from "../lib/auth/api-key";
import { db } from "../lib/db/client";
import { projects } from "../lib/db/schema";

const app = new Hono();

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

/**
 * Bootstrap endpoint for creating the first project.
 * Protected by ADMIN_SECRET env var or open if not set (dev mode).
 */
app.post("/projects", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const authHeader = c.req.header("Authorization");
    if (authHeader !== `Bearer ${adminSecret}`) {
      return c.json({ error: "Invalid admin secret" }, 403);
    }
  }

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

  // Check for existing project
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
      { error: "Project already registered", projectId: existingRows[0]!.id },
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

  // Generate an initial API key
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

export default app;
