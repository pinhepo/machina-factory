import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import apiKeysRoutes from "./routes/api-keys";
import bootstrapRoutes from "./routes/bootstrap";
import healthRoutes from "./routes/health";
import jobLogsRoutes from "./routes/job-logs";
import jobsRoutes from "./routes/jobs";
import queuesRoutes from "./routes/queues";
import projectsRoutes from "./routes/projects";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Global middleware
app.use("*", cors());
app.use("*", logger());
app.onError(errorHandler);

// Public routes
app.route("/health", healthRoutes);
app.route("/bootstrap", bootstrapRoutes);

// Authenticated routes
app.use("/v1/*", authMiddleware);
app.route("/v1/projects", projectsRoutes);
app.route("/v1/projects", apiKeysRoutes);
app.route("/v1/jobs", jobsRoutes);
app.route("/v1/jobs", jobLogsRoutes);
app.route("/v1/queues", queuesRoutes);

// Root
app.get("/", (c) => {
  return c.json({
    name: "machina-factory",
    version: "0.1.0",
    docs: "/health",
  });
});

const port = Number(process.env.PORT ?? 3000);

console.log(`Machina Factory API starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
