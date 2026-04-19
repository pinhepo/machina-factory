import type { Context } from "hono";

/**
 * Global error handler for unhandled exceptions.
 */
export function errorHandler(err: Error, c: Context): Response {
  console.error("[API Error]", err.message, err.stack);

  if (err.message.includes("POSTGRES_URL")) {
    return c.json({ error: "Database not configured" }, 503);
  }

  return c.json(
    {
      error: "Internal server error",
      ...(process.env.NODE_ENV !== "production" && {
        message: err.message,
      }),
    },
    500,
  );
}
