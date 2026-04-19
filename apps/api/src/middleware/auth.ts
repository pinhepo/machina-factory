import type { Context, Next } from "hono";
import { validateApiKey } from "../lib/auth/api-key";
import type { AppEnv } from "../types";

/**
 * API key authentication middleware.
 * Validates Bearer token and attaches projectId to context.
 */
export async function authMiddleware(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | undefined> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      { error: "Missing or invalid Authorization header. Use: Bearer mf_..." },
      401,
    );
  }

  const token = authHeader.slice("Bearer ".length);
  const result = await validateApiKey(token);

  if (!result) {
    return c.json({ error: "Invalid or expired API key" }, 401);
  }

  c.set("projectId", result.projectId);
  await next();
}
