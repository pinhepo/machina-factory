/**
 * Shared Hono app environment type.
 * Defines the custom variables set by middleware (e.g. authMiddleware sets projectId).
 */
export type AppEnv = {
  Variables: {
    projectId: string;
  };
};
