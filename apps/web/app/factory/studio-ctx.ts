import { createHmac, timingSafeEqual } from "node:crypto";

export interface StudioProjectContext {
  projectId: string;
  orgId: string;
  name: string;
  clientApiUrl?: string;
  apiKey?: string;
  suggestedRepo?: { owner: string; name: string; branch?: string };
  /**
   * Origin of the Studio instance that minted this ctx
   * (e.g. https://studio-staging.machina.gg). Used when the Factory
   * needs to link back to the Studio (e.g. the "Open in Studio"
   * button on a completed job) so staging points at staging and
   * prod points at prod.
   */
  studioBaseUrl?: string;
  issuedAt: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(): string {
  const secret = process.env.FACTORY_STUDIO_SHARED_SECRET;
  if (!secret) {
    throw new Error("FACTORY_STUDIO_SHARED_SECRET is not set");
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(normalized, "base64");
}

export function signStudioCtx(ctx: StudioProjectContext): string {
  const payload = b64url(JSON.stringify(ctx));
  const sig = b64url(
    createHmac("sha256", getSecret()).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifyStudioCtx(token: string): StudioProjectContext | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;

    const expected = createHmac("sha256", getSecret()).update(payload).digest();
    const provided = b64urlDecode(sig);
    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;

    const ctx = JSON.parse(
      b64urlDecode(payload).toString("utf-8"),
    ) as StudioProjectContext;

    if (
      typeof ctx.issuedAt !== "number" ||
      Date.now() - ctx.issuedAt > TOKEN_TTL_MS
    ) {
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}
