import { handle } from "@hono/node-server/vercel";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/error-handler";
import apiKeysRoutes from "../src/routes/api-keys";
import bootstrapRoutes from "../src/routes/bootstrap";
import healthRoutes from "../src/routes/health";
import jobLogsRoutes from "../src/routes/job-logs";
import jobsRoutes from "../src/routes/jobs";
import projectsRoutes from "../src/routes/projects";
import type { AppEnv } from "../src/types";

const app = new Hono<AppEnv>();

app.use("*", cors());
app.use("*", logger());
app.onError(errorHandler);

app.route("/health", healthRoutes);
app.route("/bootstrap", bootstrapRoutes);

app.use("/v1/*", authMiddleware);
app.route("/v1/projects", projectsRoutes);
app.route("/v1/projects", apiKeysRoutes);
app.route("/v1/jobs", jobsRoutes);
app.route("/v1/jobs", jobLogsRoutes);

app.get("/", (c) => {
  return c.json({
    name: "machina-factory",
    version: "0.1.0",
    docs: "/health",
  });
});

export default handle(app);
