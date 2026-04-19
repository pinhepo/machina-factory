import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { generateApiKey } from "../lib/auth/api-key";
import { db } from "../lib/db/client";
import { apiKeys } from "../lib/db/schema";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

const createKeySchema = z.object({
  name: z.string().optional(),
});

app.post("/:projectId/keys", async (c) => {
  const projectId = c.req.param("projectId");
  const authenticatedProjectId = c.get("projectId");

  // Ensure the API key belongs to the same project
  if (projectId !== authenticatedProjectId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = createKeySchema.safeParse(body);
  const name = parsed.success ? parsed.data.name : undefined;

  const { id, key, prefix } = await generateApiKey(projectId, name);

  return c.json({ id, key, prefix }, 201);
});

app.get("/:projectId/keys", async (c) => {
  const projectId = c.req.param("projectId");
  const authenticatedProjectId = c.get("projectId");

  if (projectId !== authenticatedProjectId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.keyPrefix,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId));

  return c.json({ keys });
});

export default app;
