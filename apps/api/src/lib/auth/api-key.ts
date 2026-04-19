import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { apiKeys } from "../db/schema";

const API_KEY_PREFIX = "mf_";
const KEY_LENGTH = 32;

/**
 * Generate a new API key with the `mf_` prefix.
 * Returns the raw key (to show to the user once) and the hash (to store).
 */
export async function generateApiKey(
  projectId: string,
  name?: string,
): Promise<{ id: string; key: string; prefix: string }> {
  const rawKey = `${API_KEY_PREFIX}${nanoid(KEY_LENGTH)}`;
  const keyHash = await hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, API_KEY_PREFIX.length + 8);
  const id = nanoid();

  await db
    .insert(apiKeys)
    .values({
      id,
      projectId,
      keyHash,
      keyPrefix,
      name,
    })
    .returning({ id: apiKeys.id });

  return { id, key: rawKey, prefix: keyPrefix };
}

/**
 * Validate an API key and return the associated project ID.
 * Returns null if the key is invalid or expired.
 */
export async function validateApiKey(
  rawKey: string,
): Promise<{ projectId: string } | null> {
  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = await hashKey(rawKey);

  const result = await db
    .select({ projectId: apiKeys.projectId, expiresAt: apiKeys.expiresAt })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const record = result[0] as (typeof result)[number] | undefined;

  if (!record) {
    return null;
  }

  // Check expiry
  if (record.expiresAt && record.expiresAt < new Date()) {
    return null;
  }

  // Update last used timestamp (awaited to avoid neon-http conflicts)
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.keyHash, keyHash))
    .returning({ id: apiKeys.id });

  return { projectId: record.projectId };
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
