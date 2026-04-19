import { type NextRequest, NextResponse } from "next/server";

const IFRAME_COOKIE = "factory-studio-auth";
const IFRAME_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CTX_TTL_MS = 10 * 60 * 1000; // matches signer TTL
const textEncoder = new TextEncoder();

function b64urlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyStudioCtx(token: string): Promise<boolean> {
  const secret = process.env.FACTORY_STUDIO_SHARED_SECRET;
  if (!secret) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload)),
    );
    const provided = b64urlToBytes(sig);
    if (!timingSafeEqual(expected, provided)) return false;

    const decoded = new TextDecoder().decode(b64urlToBytes(payload));
    const ctx = JSON.parse(decoded) as { issuedAt?: number };
    if (
      typeof ctx.issuedAt !== "number" ||
      Date.now() - ctx.issuedAt > CTX_TTL_MS
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * On any `/factory/*` request carrying a valid signed ctx, mint a short-
 * lived iframe-session cookie so subsequent navigations inside the
 * Studio-embedded iframe (e.g. redirect to `/factory/<id>` after creating
 * a job) stay authenticated without carrying ?ctx= every time.
 *
 * Server Components can't call `cookies().set()`, which is why this lives
 * in middleware. Uses Web Crypto because Edge runtime doesn't expose
 * `node:crypto`.
 */
export async function middleware(request: NextRequest) {
  const ctxParam = request.nextUrl.searchParams.get("ctx");
  if (!ctxParam) return NextResponse.next();

  const ok = await verifyStudioCtx(ctxParam);
  if (!ok) return NextResponse.next();

  const cookieValue = btoa(
    JSON.stringify({ valid: true, expires: Date.now() + IFRAME_TTL_MS }),
  );

  const response = NextResponse.next();
  response.cookies.set(IFRAME_COOKIE, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: IFRAME_TTL_MS / 1000,
    path: "/",
  });
  return response;
}

export const config = {
  matcher: ["/factory/:path*"],
};
