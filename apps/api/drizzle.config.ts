import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  ...(process.env.POSTGRES_URL && {
    dbCredentials: {
      url: process.env.POSTGRES_URL,
    },
  }),
});
