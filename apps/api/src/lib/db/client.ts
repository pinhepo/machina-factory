import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzleNeonHttp<typeof schema>>;

let _db: DrizzleClient | null = null;

function getUrl(): string {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL environment variable is required");
  }
  return url;
}

/**
 * Database client.
 * Uses neon-http (HTTP) for Neon URLs (works in Vercel serverless).
 * Falls back to postgres.js (TCP) for local PostgreSQL.
 */
export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    if (!_db) {
      const url = getUrl();
      const isNeon = url.includes("neon.tech");

      if (isNeon) {
        const sql = neon(url);
        _db = drizzleNeonHttp(sql, { schema }) as DrizzleClient;
      } else {
        const client = postgres(url);
        _db = drizzlePostgres(client, { schema }) as unknown as DrizzleClient;
      }
    }
    return Reflect.get(_db, prop);
  },
});
